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
if (!$input) { echo json_encode(['error' => 'Invalid JSON']); exit; }

$required = ['email', 'legalMatter', 'urgency', 'caseDescription', 'preferredContact'];
foreach ($required as $f) {
    if (empty($input[$f])) { echo json_encode(['error' => "Missing: $f"]); exit; }
}

// Pull name from registration data if available (passed from cognito-auth.js)
$firstName = $input['firstName'] ?? '';
$lastName  = $input['lastName']  ?? '';
$email     = strtolower(trim($input['email']));

try {
    // Upsert into legal_onboarding
    $stmt = $pdo->prepare("
        INSERT INTO legal_onboarding
            (email, first_name, last_name, legal_matter, urgency, case_description,
             preferred_contact, best_time, submitted_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'pending_review')
        ON DUPLICATE KEY UPDATE
            legal_matter = VALUES(legal_matter),
            urgency = VALUES(urgency),
            case_description = VALUES(case_description),
            preferred_contact = VALUES(preferred_contact),
            best_time = VALUES(best_time),
            submitted_at = NOW(),
            status = 'pending_review'
    ");
    $stmt->execute([
        $email, $firstName, $lastName,
        $input['legalMatter'], $input['urgency'], $input['caseDescription'],
        $input['preferredContact'], $input['bestTime'] ?? null
    ]);

    sendAdminApprovalEmail($email, $firstName, $lastName, $input);

    echo json_encode(['success' => true]);

} catch (Exception $e) {
    error_log("Legal onboarding error: " . $e->getMessage());
    echo json_encode(['error' => 'Server error']);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeHmacToken(string $email, string $action): string {
    return hash_hmac('sha256', "$email:$action", HMAC_SECRET);
}

function sendAdminApprovalEmail(string $email, string $firstName, string $lastName, array $data): void {
    $approveToken = makeHmacToken($email, 'approve');
    $denyToken    = makeHmacToken($email, 'deny');

    $lambdaUrl = LAMBDA_APPROVER_URL; // defined in config.php

    $approveUrl = $lambdaUrl . '?' . http_build_query([
        'email'  => $email,
        'action' => 'approve',
        'token'  => $approveToken
    ]);
    $denyUrl = $lambdaUrl . '?' . http_build_query([
        'email'  => $email,
        'action' => 'deny',
        'token'  => $denyToken
    ]);

    $matterLabels = [
        'estate-planning' => 'Estate Planning',
        'probate'         => 'Probate Administration',
        'personal-injury' => 'Personal Injury',
        'criminal-defense'=> 'Criminal Defense',
        'expungement'     => 'Criminal Record Expungement',
        'traffic'         => 'Traffic Violations',
        'other'           => 'Other'
    ];
    $urgencyLabels = [
        'immediate'    => 'Immediate (within 1 week)',
        'soon'         => 'Soon (within 1 month)',
        'planning'     => 'Planning ahead (no rush)',
        'consultation' => 'Just need consultation'
    ];

    $matter  = $matterLabels[$data['legalMatter']] ?? $data['legalMatter'];
    $urgency = $urgencyLabels[$data['urgency']]    ?? $data['urgency'];
    $name    = trim("$firstName $lastName") ?: $email;
    $desc    = nl2br(htmlspecialchars($data['caseDescription']));
    $contact = htmlspecialchars($data['preferredContact']);
    $time    = htmlspecialchars($data['bestTime'] ?? 'Not specified');
    $date    = date('F j, Y \a\t g:i A T');

    $subject = "New Client Intake — $name ($matter)";

    $html = <<<HTML
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
  .card { background: #fff; max-width: 640px; margin: 0 auto; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
  .header { background: #1a365d; color: #fff; padding: 24px 32px; }
  .header h1 { margin: 0; font-size: 20px; }
  .header p  { margin: 4px 0 0; opacity: .8; font-size: 13px; }
  .body { padding: 28px 32px; }
  .field { margin-bottom: 14px; }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #666; margin-bottom: 2px; }
  .value { font-size: 15px; color: #111; }
  .desc-box { background: #f8f8f8; border-left: 3px solid #1a365d; padding: 12px 16px; border-radius: 0 4px 4px 0; font-size: 14px; color: #333; line-height: 1.6; }
  .divider { border: none; border-top: 1px solid #eee; margin: 24px 0; }
  .actions { text-align: center; padding: 0 32px 32px; }
  .actions p { color: #555; font-size: 13px; margin-bottom: 20px; }
  .btn { display: inline-block; padding: 14px 36px; border-radius: 5px; font-size: 15px; font-weight: bold; text-decoration: none; margin: 0 8px; }
  .btn-approve { background: #16a34a; color: #fff; }
  .btn-deny    { background: #dc2626; color: #fff; }
  .footer { background: #f0f0f0; padding: 16px 32px; font-size: 12px; color: #888; text-align: center; }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>New Client Intake Form</h1>
    <p>Submitted $date</p>
  </div>
  <div class="body">
    <div class="field">
      <div class="label">Client Name</div>
      <div class="value">$name</div>
    </div>
    <div class="field">
      <div class="label">Email</div>
      <div class="value">$email</div>
    </div>
    <div class="field">
      <div class="label">Legal Matter</div>
      <div class="value">$matter</div>
    </div>
    <div class="field">
      <div class="label">Urgency</div>
      <div class="value">$urgency</div>
    </div>
    <div class="field">
      <div class="label">Preferred Contact</div>
      <div class="value">$contact &nbsp;|&nbsp; Best time: $time</div>
    </div>
    <hr class="divider">
    <div class="field">
      <div class="label">Case Description</div>
      <div class="desc-box">$desc</div>
    </div>
    <hr class="divider">
    <div style="font-size:12px;color:#888;">
      ✅ No Attorney-Client Relationship acknowledged<br>
      ✅ Consent to contact<br>
      ✅ Privacy Policy agreed<br>
      ✅ Time-sensitive matter understood
    </div>
  </div>
  <div class="actions">
    <p>Review the intake above and click to approve or deny portal access for this client.</p>
    <a href="$approveUrl" class="btn btn-approve">✓ Approve Access</a>
    <a href="$denyUrl"    class="btn btn-deny">✗ Deny Access</a>
  </div>
  <div class="footer">Johnson Legal Team &bull; 1221 Bowers St, Birmingham, MI 48012 &bull; (313) 355-2216</div>
</div>
</body>
</html>
HTML;

    // Send via SES using AWS SDK (preferred) or fall back to PHP mail()
    if (defined('USE_SES') && USE_SES) {
        sendViaSES(ADMIN_EMAILS, $subject, $html);
    } else {
        $headers  = "From: " . FROM_EMAIL . "\r\n";
        $headers .= "MIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n";
        foreach (explode(',', ADMIN_EMAILS) as $adminEmail) {
            mail(trim($adminEmail), $subject, $html, $headers);
        }
    }
}

function sendViaSES(string $recipients, string $subject, string $html): void {
    // Requires AWS SDK for PHP (composer require aws/aws-sdk-php)
    $sdk = new \Aws\Ses\SesClient([
        'version' => 'latest',
        'region'  => 'us-east-1'
    ]);
    $sdk->sendEmail([
        'Source'      => FROM_EMAIL,
        'Destination' => ['ToAddresses' => array_map('trim', explode(',', $recipients))],
        'Message'     => [
            'Subject' => ['Data' => $subject],
            'Body'    => ['Html' => ['Data' => $html]]
        ]
    ]);
}
