<?php
require_once 'config.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// Request password reset
if ($method === 'POST' && $action === 'request') {
    $data = json_decode(file_get_contents('php://input'), true);
    $email = filter_var($data['email'], FILTER_VALIDATE_EMAIL);
    
    if (!$email) {
        jsonResponse(['error' => 'Valid email required'], 400);
    }
    
    try {
        $stmt = $pdo->prepare("SELECT id, first_name FROM clients WHERE email = ?");
        $stmt->execute([$email]);
        $client = $stmt->fetch();
        
        if ($client) {
            $reset_token = bin2hex(random_bytes(32));
            $expires = date('Y-m-d H:i:s', strtotime('+1 hour'));
            
            $stmt = $pdo->prepare("UPDATE clients SET reset_token = ?, reset_token_expires = ? WHERE id = ?");
            $stmt->execute([$reset_token, $expires, $client['id']]);
            
            // Send reset email
            sendPasswordResetEmail($email, $client['first_name'], $reset_token);
        }
        
        // Always return success to prevent email enumeration
        jsonResponse(['success' => true, 'message' => 'If that email exists, a reset link has been sent']);
    } catch(PDOException $e) {
        jsonResponse(['error' => 'Request failed'], 500);
    }
}

// Reset password
if ($method === 'POST' && $action === 'reset') {
    $data = json_decode(file_get_contents('php://input'), true);
    $token = $data['token'];
    $password = $data['password'];
    
    if (!$token || !$password || strlen($password) < 8) {
        jsonResponse(['error' => 'Invalid data'], 400);
    }
    
    try {
        $stmt = $pdo->prepare("SELECT id FROM clients WHERE reset_token = ? AND reset_token_expires > NOW()");
        $stmt->execute([$token]);
        $client = $stmt->fetch();
        
        if (!$client) {
            jsonResponse(['error' => 'Invalid or expired reset link'], 400);
        }
        
        $password_hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare("UPDATE clients SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?");
        $stmt->execute([$password_hash, $client['id']]);
        
        jsonResponse(['success' => true, 'message' => 'Password reset successfully']);
    } catch(PDOException $e) {
        jsonResponse(['error' => 'Reset failed'], 500);
    }
}

jsonResponse(['error' => 'Invalid request'], 400);

function sendPasswordResetEmail($email, $first_name, $token) {
    require_once 'PHPMailer/PHPMailer.php';
    require_once 'PHPMailer/SMTP.php';
    require_once 'PHPMailer/Exception.php';
    
    $mail = new PHPMailer\PHPMailer\PHPMailer(true);
    
    try {
        $mail->isSMTP();
        $mail->Host = SMTP_HOST;
        $mail->SMTPAuth = true;
        $mail->Username = SMTP_USERNAME;
        $mail->Password = SMTP_PASSWORD;
        $mail->SMTPSecure = SMTP_ENCRYPTION;
        $mail->Port = SMTP_PORT;
        
        $mail->setFrom(FROM_EMAIL, SITE_NAME);
        $mail->addAddress($email);
        $mail->isHTML(true);
        $mail->Subject = "Password Reset Request - " . SITE_NAME;
        
        $reset_link = SITE_URL . "/reset-password.html?token=" . $token;
        
        $mail->Body = "
            <html>
            <body style='font-family: Arial, sans-serif;'>
                <h2>Password Reset Request</h2>
                <p>Hi {$first_name},</p>
                <p>We received a request to reset your password. Click the button below to reset it:</p>
                <p style='margin-top: 20px;'>
                    <a href='{$reset_link}' 
                       style='background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;'>
                        Reset Password
                    </a>
                </p>
                <p>Or copy this link: {$reset_link}</p>
                <p><strong>This link expires in 1 hour.</strong></p>
                <p>If you didn't request this, please ignore this email.</p>
                <p>Best regards,<br>" . SITE_NAME . "</p>
            </body>
            </html>
        ";
        
        $mail->send();
        return true;
    } catch (Exception $e) {
        error_log("Password reset email failed: " . $mail->ErrorInfo);
        return false;
    }
}
?>
