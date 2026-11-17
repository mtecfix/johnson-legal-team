<?php
/** POST /api/onboarding.php: store a client onboarding submission and email admins approve/deny links. */
declare(strict_types=1);

$input = readJsonPost();
requireFields($input, ['email', 'legalMatter', 'urgency', 'caseDescription', 'preferredContact']);

$email = normalizeEmail(field($input, 'email', 254));
$item = [
    'email' => $email,
    // Sort key: timestamp + random suffix, so two submissions in the same second never overwrite each other.
    'submission_id' => gmdate('Y-m-d\TH:i:s') . sprintf('.%06dZ#', (int) (microtime(true) * 1e6) % 1000000) . bin2hex(random_bytes(4)),
    'submitted_at' => nowIso(),
    'legal_matter' => oneOf(field($input, 'legalMatter', 40), array_keys(LEGAL_MATTERS), 'legalMatter'),
    'urgency' => oneOf(field($input, 'urgency', 40), array_keys(URGENCY_LEVELS), 'urgency'),
    'case_description' => field($input, 'caseDescription', 5000),
    'preferred_contact' => oneOf(field($input, 'preferredContact', 20), CONTACT_METHODS, 'preferredContact'),
    'best_time' => oneOf(field($input, 'bestTime', 20), BEST_TIMES, 'bestTime'),
    'referral_source' => field($input, 'referralSource', 200),
    'previous_attorney' => field($input, 'previousAttorney', 200),
    'additional_notes' => field($input, 'additionalNotes', 5000),
    'status' => 'pending',
];

// Every submission is kept (the original INSERTed a new row each time).
db()->putItem([
    'TableName' => table('client_onboarding'),
    'Item' => marshaler()->marshalItem(array_filter($item, fn ($v) => $v !== null)),
]);

sendEmail(
    adminRecipients(),
    "New Client Onboarding - $email",
    emailLayout('New Client Onboarding Submission', 'Submitted ' . gmdate('F j, Y g:i A') . ' UTC', emailRows([
        'Email' => $email, 'Legal Matter' => LEGAL_MATTERS[$item['legal_matter']],
        'Urgency' => URGENCY_LEVELS[$item['urgency']], 'Description' => $item['case_description'],
        'Preferred Contact' => $item['preferred_contact'], 'Best Time' => $item['best_time'],
        'Referral Source' => $item['referral_source'], 'Previous Attorney' => $item['previous_attorney'],
        'Additional Notes' => $item['additional_notes'],
    ]), approvalButtons($email, 'client'))
);

jsonResponse(['success' => true, 'message' => 'Onboarding submitted successfully']);
