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
$required = ['email', 'legalMatter', 'urgency', 'caseDescription', 'preferredContact'];
foreach ($required as $field) {
    if (empty($input[$field])) {
        echo json_encode(['error' => "Missing required field: $field"]);
        exit;
    }
}

try {
    // Store onboarding data
    $stmt = $pdo->prepare("
        INSERT INTO client_onboarding 
        (email, legal_matter, urgency, case_description, preferred_contact, 
         best_time, referral_source, previous_attorney, additional_notes, 
         submitted_at, status) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'pending')
    ");
    
    $stmt->execute([
        $input['email'],
        $input['legalMatter'],
        $input['urgency'],
        $input['caseDescription'],
        $input['preferredContact'],
        $input['bestTime'] ?? null,
        $input['referralSource'] ?? null,
        $input['previousAttorney'] ?? null,
        $input['additionalNotes'] ?? null
    ]);

    // Send notification email to admin
    $adminEmail = WEBMASTER_EMAIL;
    $subject = "New Client Onboarding - " . $input['email'];
    
    $message = "
    <h3>New Client Onboarding Submission</h3>
    <p><strong>Email:</strong> {$input['email']}</p>
    <p><strong>Legal Matter:</strong> {$input['legalMatter']}</p>
    <p><strong>Urgency:</strong> {$input['urgency']}</p>
    <p><strong>Description:</strong> {$input['caseDescription']}</p>
    <p><strong>Preferred Contact:</strong> {$input['preferredContact']}</p>
    <p><strong>Best Time:</strong> " . ($input['bestTime'] ?? 'Not specified') . "</p>
    <p><strong>Referral Source:</strong> " . ($input['referralSource'] ?? 'Not specified') . "</p>
    <p><strong>Previous Attorney:</strong> " . ($input['previousAttorney'] ?? 'Not specified') . "</p>
    <p><strong>Additional Notes:</strong> " . ($input['additionalNotes'] ?? 'None') . "</p>
    
    <p><a href='" . $_SERVER['HTTP_HOST'] . "/api/approve-registration.php?email=" . urlencode($input['email']) . "&action=approve'>Approve Client</a></p>
    <p><a href='" . $_SERVER['HTTP_HOST'] . "/api/approve-registration.php?email=" . urlencode($input['email']) . "&action=deny'>Deny Client</a></p>
    ";

    // Send email using PHPMailer (simplified)
    mail($adminEmail, $subject, $message, "Content-Type: text/html; charset=UTF-8");

    echo json_encode(['success' => true, 'message' => 'Onboarding submitted successfully']);

} catch (Exception $e) {
    error_log("Onboarding error: " . $e->getMessage());
    echo json_encode(['error' => 'Database error occurred']);
}
?>
