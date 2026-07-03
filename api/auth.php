<?php
require_once 'config.php';

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// Register new client
if ($method === 'POST' && $action === 'register') {
    $data = json_decode(file_get_contents('php://input'), true);
    
    $email = filter_var($data['email'], FILTER_VALIDATE_EMAIL);
    $password = $data['password'];
    $first_name = trim($data['first_name']);
    $last_name = trim($data['last_name']);
    $phone = trim($data['phone'] ?? '');
    
    if (!$email || !$password || !$first_name || !$last_name) {
        jsonResponse(['error' => 'All fields required'], 400);
    }
    
    if (strlen($password) < 8) {
        jsonResponse(['error' => 'Password must be at least 8 characters'], 400);
    }
    
    try {
        $stmt = $pdo->prepare("SELECT id FROM clients WHERE email = ?");
        $stmt->execute([$email]);
        if ($stmt->fetch()) {
            jsonResponse(['error' => 'Email already registered'], 400);
        }
        
        $password_hash = password_hash($password, PASSWORD_DEFAULT);
        $approval_token = bin2hex(random_bytes(32));
        
        $stmt = $pdo->prepare("INSERT INTO clients (email, password_hash, first_name, last_name, phone, status, approval_token) VALUES (?, ?, ?, ?, ?, 'pending', ?)");
        $stmt->execute([$email, $password_hash, $first_name, $last_name, $phone, $approval_token]);
        
        $client_id = $pdo->lastInsertId();
        
        // Send notification to webmaster
        sendWebmasterNotification([
            'id' => $client_id,
            'email' => $email,
            'first_name' => $first_name,
            'last_name' => $last_name,
            'phone' => $phone,
            'auth_provider' => 'Email/Password',
            'token' => $approval_token
        ]);
        
        jsonResponse(['success' => true, 'message' => 'Account created! Awaiting admin approval. You will receive an email once approved.']);
    } catch(PDOException $e) {
        jsonResponse(['error' => 'Registration failed'], 500);
    }
}

// Login
if ($method === 'POST' && $action === 'login') {
    // Rate limiting
    if (!checkRateLimit('login', 5, 300)) { // 5 attempts per 5 minutes
        jsonResponse(['error' => 'Too many login attempts. Please try again later.'], 429);
    }
    
    $data = json_decode(file_get_contents('php://input'), true);
    
    $email = filter_var($data['email'], FILTER_VALIDATE_EMAIL);
    $password = $data['password'];
    
    if (!$email || !$password) {
        jsonResponse(['error' => 'Email and password required'], 400);
    }
    
    try {
        $stmt = $pdo->prepare("SELECT * FROM clients WHERE email = ?");
        $stmt->execute([$email]);
        $client = $stmt->fetch();
        
        if (!$client) {
            jsonResponse(['error' => 'Invalid credentials'], 401);
        }
        
        if ($client['status'] === 'pending') {
            jsonResponse(['error' => 'Your account is pending approval. Please wait for admin confirmation.'], 403);
        }
        
        if ($client['status'] === 'inactive') {
            jsonResponse(['error' => 'Your account has been deactivated. Please contact support.'], 403);
        }
        
        if (password_verify($password, $client['password_hash'])) {
            $_SESSION['client_id'] = $client['id'];
            $_SESSION['client_email'] = $client['email'];
            $_SESSION['client_name'] = $client['first_name'] . ' ' . $client['last_name'];
            
            $stmt = $pdo->prepare("UPDATE clients SET last_login = NOW() WHERE id = ?");
            $stmt->execute([$client['id']]);
            
            jsonResponse([
                'success' => true,
                'client' => [
                    'id' => $client['id'],
                    'email' => $client['email'],
                    'name' => $_SESSION['client_name']
                ]
            ]);
        } else {
            jsonResponse(['error' => 'Invalid credentials'], 401);
        }
    } catch(PDOException $e) {
        jsonResponse(['error' => 'Login failed'], 500);
    }
}

// Logout
if ($method === 'POST' && $action === 'logout') {
    session_destroy();
    jsonResponse(['success' => true]);
}

// Get current user
if ($method === 'GET' && $action === 'me') {
    requireLogin();
    
    try {
        $stmt = $pdo->prepare("SELECT id, email, first_name, last_name, phone, address, created_at FROM clients WHERE id = ?");
        $stmt->execute([$_SESSION['client_id']]);
        $client = $stmt->fetch();
        
        jsonResponse(['client' => $client]);
    } catch(PDOException $e) {
        jsonResponse(['error' => 'Failed to fetch user'], 500);
    }
}

jsonResponse(['error' => 'Invalid request'], 400);
?>
