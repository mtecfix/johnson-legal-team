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

// Auto-approve admin users
$autoApproveUsers = ['mrtechfixes.ai@gmail.com', 'mrtechfixes@gmail.com', 'johnsonlegalteam@gmail.com'];

if (in_array($email, $autoApproveUsers)) {
    echo json_encode(['approved' => true, 'role' => 'admin']);
    exit;
}

try {
    // Check approval status in database
    $stmt = $pdo->prepare("SELECT status FROM legal_onboarding WHERE email = ? ORDER BY submitted_at DESC LIMIT 1");
    $stmt->execute([$email]);
    $result = $stmt->fetch();
    
    if ($result) {
        $approved = ($result['status'] === 'approved');
        echo json_encode(['approved' => $approved, 'status' => $result['status']]);
    } else {
        // No onboarding record found - not approved
        echo json_encode(['approved' => false, 'status' => 'no_record']);
    }

} catch (Exception $e) {
    error_log("Approval check error: " . $e->getMessage());
    echo json_encode(['error' => 'Database error occurred']);
}
?>
