<?php
require_once '../config.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

if (!$input || !isset($input['email'])) {
    echo json_encode(['error' => 'Email required']);
    exit;
}

$email = $input['email'];

try {
    // Check if user profile exists
    $stmt = $pdo->prepare("SELECT id, role, status FROM user_profiles WHERE email = ?");
    $stmt->execute([$email]);
    $result = $stmt->fetch();
    
    if ($result) {
        echo json_encode([
            'registered' => true, 
            'role' => $result['role'],
            'status' => $result['status']
        ]);
    } else {
        echo json_encode(['registered' => false]);
    }

} catch (Exception $e) {
    error_log("Registration check error: " . $e->getMessage());
    echo json_encode(['error' => 'Database error occurred']);
}
?>
