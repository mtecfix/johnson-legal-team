<?php
require_once '../config.php';

// Get authorization code from Google
$code = $_GET['code'] ?? null;

if (!$code) {
    header('Location: ../client-login.html?error=no_code');
    exit;
}

// Exchange code for access token
$token_url = 'https://oauth2.googleapis.com/token';
$token_data = [
    'code' => $code,
    'client_id' => GOOGLE_CLIENT_ID,
    'client_secret' => GOOGLE_CLIENT_SECRET,
    'redirect_uri' => GOOGLE_REDIRECT_URI,
    'grant_type' => 'authorization_code'
];

$ch = curl_init($token_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($token_data));
$response = curl_exec($ch);
curl_close($ch);

$token_response = json_decode($response, true);

if (!isset($token_response['access_token'])) {
    header('Location: ../client-login.html?error=token_failed');
    exit;
}

// Get user info from Google
$user_info_url = 'https://www.googleapis.com/oauth2/v2/userinfo';
$ch = curl_init($user_info_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer ' . $token_response['access_token']
]);
$user_response = curl_exec($ch);
curl_close($ch);

$user_info = json_decode($user_response, true);

if (!isset($user_info['email'])) {
    header('Location: ../client-login.html?error=user_info_failed');
    exit;
}

// Check if user exists
try {
    $stmt = $pdo->prepare("SELECT * FROM clients WHERE email = ? OR google_id = ?");
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
        
        // Update existing user
        $stmt = $pdo->prepare("UPDATE clients SET google_id = ?, profile_picture = ?, last_login = NOW() WHERE id = ?");
        $stmt->execute([$user_info['id'], $user_info['picture'] ?? null, $client['id']]);
        $client_id = $client['id'];
    } else {
        // Create new user with pending status
        $names = explode(' ', $user_info['name'], 2);
        $first_name = $names[0];
        $last_name = $names[1] ?? '';
        
        $approval_token = bin2hex(random_bytes(32));
        
        $stmt = $pdo->prepare("INSERT INTO clients (email, first_name, last_name, google_id, profile_picture, auth_provider, status, approval_token) VALUES (?, ?, ?, ?, ?, 'google', 'pending', ?)");
        $stmt->execute([
            $user_info['email'],
            $first_name,
            $last_name,
            $user_info['id'],
            $user_info['picture'] ?? null,
            $approval_token
        ]);
        $client_id = $pdo->lastInsertId();
        
        // Send notification to webmaster
        sendWebmasterNotification([
            'id' => $client_id,
            'email' => $user_info['email'],
            'first_name' => $first_name,
            'last_name' => $last_name,
            'phone' => '',
            'auth_provider' => 'Google SSO',
            'token' => $approval_token
        ]);
        
        header('Location: ../client-login.html?success=pending_approval');
        exit;
    }
    
    // Set session
    $_SESSION['client_id'] = $client_id;
    $_SESSION['client_email'] = $user_info['email'];
    $_SESSION['client_name'] = $user_info['name'];
    $_SESSION['client_picture'] = $user_info['picture'] ?? null;
    
    header('Location: ../client-dashboard.html');
    exit;
    
} catch(PDOException $e) {
    header('Location: ../client-login.html?error=database_error');
    exit;
}
?>
