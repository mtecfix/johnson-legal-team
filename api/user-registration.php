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

if (!$input) {
    echo json_encode(['error' => 'Invalid JSON data']);
    exit;
}

// Validate required fields
$required = ['email', 'role', 'firstName', 'lastName', 'phone'];
foreach ($required as $field) {
    if (empty($input[$field])) {
        echo json_encode(['error' => "Missing required field: $field"]);
        exit;
    }
}

try {
    // Check if user already registered
    $stmt = $pdo->prepare("SELECT id FROM user_profiles WHERE email = ?");
    $stmt->execute([$input['email']]);
    
    if ($stmt->fetch()) {
        echo json_encode(['error' => 'User already registered']);
        exit;
    }

    // Insert user profile
    $stmt = $pdo->prepare("
        INSERT INTO user_profiles 
        (email, role, first_name, last_name, phone, address, city, state, zip_code, 
         company_name, preferred_contact, timezone, department, job_title, permissions, 
         access_level, emergency_contact, system_role, registered_at, status) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'active')
    ");
    
    $stmt->execute([
        $input['email'],
        $input['role'],
        $input['firstName'],
        $input['lastName'],
        $input['phone'],
        $input['address'] ?? null,
        $input['city'] ?? null,
        $input['state'] ?? null,
        $input['zipCode'] ?? null,
        $input['companyName'] ?? null,
        $input['preferredContact'] ?? null,
        $input['timezone'] ?? null,
        $input['department'] ?? null,
        $input['jobTitle'] ?? null,
        isset($input['permissions']) ? json_encode($input['permissions']) : null,
        $input['accessLevel'] ?? null,
        $input['emergencyContact'] ?? null,
        $input['systemRole'] ?? null
    ]);

    // Send notification email
    $adminEmail = 'mrtechfixes.ai@gmail.com';
    $subject = "New User Registration - " . $input['firstName'] . " " . $input['lastName'];
    
    $roleLabel = $input['role'] === 'super_admin' ? 'Super Administrator' : 
                 $input['role'] === 'admin' ? 'Administrator' : 'Client';
    
    $message = "
    <h3>New User Registration</h3>
    <p><strong>Name:</strong> {$input['firstName']} {$input['lastName']}</p>
    <p><strong>Email:</strong> {$input['email']}</p>
    <p><strong>Role:</strong> {$roleLabel}</p>
    <p><strong>Phone:</strong> {$input['phone']}</p>
    <p><strong>Registration Time:</strong> " . date('Y-m-d H:i:s') . "</p>
    ";

    mail($adminEmail, $subject, $message, "Content-Type: text/html; charset=UTF-8");

    echo json_encode(['success' => true, 'message' => 'User registered successfully']);

} catch (Exception $e) {
    error_log("User registration error: " . $e->getMessage());
    echo json_encode(['error' => 'Database error occurred']);
}
?>
