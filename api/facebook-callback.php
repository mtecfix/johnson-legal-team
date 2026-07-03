<?php
require_once '../config.php';

// Facebook OAuth configuration
define('FACEBOOK_APP_ID', 'YOUR_FACEBOOK_APP_ID');
define('FACEBOOK_APP_SECRET', 'YOUR_FACEBOOK_APP_SECRET');
define('FACEBOOK_REDIRECT_URI', SITE_URL . '/api/facebook-callback.php');

$code = $_GET['code'] ?? null;

if (!$code) {
    header('Location: ../client-login.html?error=no_code');
    exit;
}

// Exchange code for access token
$token_url = 'https://graph.facebook.com/v18.0/oauth/access_token?' . http_build_query([
    'client_id' => FACEBOOK_APP_ID,
    'client_secret' => FACEBOOK_APP_SECRET,
    'redirect_uri' => FACEBOOK_REDIRECT_URI,
    'code' => $code
]);

$response = file_get_contents($token_url);
$token_data = json_decode($response, true);

if (!isset($token_data['access_token'])) {
    header('Location: ../client-login.html?error=token_failed');
    exit;
}

// Get user info
$user_url = 'https://graph.facebook.com/me?fields=id,name,email,picture&access_token=' . $token_data['access_token'];
$user_response = file_get_contents($user_url);
$user_info = json_decode($user_response, true);

if (!isset($user_info['email'])) {
    header('Location: ../client-login.html?error=no_email');
    exit;
}

// Process user (same as Google OAuth)
try {
    $stmt = $pdo->prepare("SELECT * FROM clients WHERE email = ? OR facebook_id = ?");
    $stmt->execute([$user_info['email'], $user_info['id']]);
    $client = $stmt->fetch();
    
    if ($client) {
        // Auto-approve OAuth users - skip pending check
        if ($client['status'] === 'inactive') {
            header('Location: ../client-login.html?error=account_inactive');
            exit;
        }
        
        // Set user as active and log them in
        $updateStmt = $pdo->prepare("UPDATE clients SET status = 'active' WHERE id = ?");
        $updateStmt->execute([$client['id']]);
        
        $_SESSION['client_id'] = $client['id'];
        $_SESSION['client_email'] = $client['email'];
        header('Location: ../client-portal-cms.html');
        exit;
            exit;
        }
        
        $stmt = $pdo->prepare("UPDATE clients SET facebook_id = ?, profile_picture = ?, last_login = NOW() WHERE id = ?");
        $stmt->execute([$user_info['id'], $user_info['picture']['data']['url'] ?? null, $client['id']]);
        $client_id = $client['id'];
    } else {
        $names = explode(' ', $user_info['name'], 2);
        $first_name = $names[0];
        $last_name = $names[1] ?? '';
        
        $approval_token = bin2hex(random_bytes(32));
        
        $stmt = $pdo->prepare("INSERT INTO clients (email, first_name, last_name, facebook_id, profile_picture, auth_provider, status, approval_token) VALUES (?, ?, ?, ?, ?, 'facebook', 'pending', ?)");
        $stmt->execute([
            $user_info['email'],
            $first_name,
            $last_name,
            $user_info['id'],
            $user_info['picture']['data']['url'] ?? null,
            $approval_token
        ]);
        $client_id = $pdo->lastInsertId();
        
        sendWebmasterNotification([
            'id' => $client_id,
            'email' => $user_info['email'],
            'first_name' => $first_name,
            'last_name' => $last_name,
            'phone' => '',
            'auth_provider' => 'Facebook SSO',
            'token' => $approval_token
        ]);
        
        header('Location: ../client-login.html?success=pending_approval');
        exit;
    }
    
    $_SESSION['client_id'] = $client_id;
    $_SESSION['client_email'] = $user_info['email'];
    $_SESSION['client_name'] = $user_info['name'];
    $_SESSION['client_picture'] = $user_info['picture']['data']['url'] ?? null;
    
    header('Location: ../client-dashboard.html');
    exit;
    
} catch(PDOException $e) {
    header('Location: ../client-login.html?error=database_error');
    exit;
}
?>
