<?php
/** POST /api/legal-onboarding.php: save (upsert) the legal intake and email admins approve/deny links. */
declare(strict_types=1);

$input = readJsonPost();
requireFields($input, ['email', 'legalMatter', 'urgency', 'caseDescription', 'preferredContact']);

$email = normalizeEmail(field($input, 'email', 254));
$item = [
    'email' => $email,
    'first_name' => field($input, 'firstName', 100),
    'last_name' => field($input, 'lastName', 100),
    'legal_matter' => oneOf(field($input, 'legalMatter', 40), array_keys(LEGAL_MATTERS), 'legalMatter'),
    'urgency' => oneOf(field($input, 'urgency', 40), array_keys(URGENCY_LEVELS), 'urgency'),
    'case_description' => field($input, 'caseDescription', 5000),
    'preferred_contact' => oneOf(field($input, 'preferredContact', 20), CONTACT_METHODS, 'preferredContact'),
    'best_time' => oneOf(field($input, 'bestTime', 20), BEST_TIMES, 'bestTime'),
    'acknowledgements' => [
        'no_attorney_relationship' => !empty($input['noAttorneyRelationship']),
        'consent_contact' => !empty($input['consentContact']),
        'privacy_policy' => !empty($input['privacyPolicy']),
        'time_sensitive' => !empty($input['timeSensitive']),
    ],
    'submitted_at' => nowIso(),
    'status' => 'pending_review',
];

// Same as the original ON DUPLICATE KEY UPDATE: one record per email, latest intake wins.
db()->putItem([
    'TableName' => table('legal_onboarding'),
    'Item' => marshaler()->marshalItem(array_filter($item, fn ($v) => $v !== null)),
]);

$name = trim(($item['first_name'] ?? '') . ' ' . ($item['last_name'] ?? '')) ?: $email;
$matter = LEGAL_MATTERS[$item['legal_matter']];
$ack = $item['acknowledgements'];
$ackHtml = '<div style="font-size:12px;color:#888">'
    . ($ack['no_attorney_relationship'] ? '&#9989;' : '&#10060;') . ' No attorney-client relationship acknowledged<br>'
    . ($ack['consent_contact'] ? '&#9989;' : '&#10060;') . ' Consent to contact<br>'
    . ($ack['privacy_policy'] ? '&#9989;' : '&#10060;') . ' Privacy Policy agreed<br>'
    . ($ack['time_sensitive'] ? '&#9989;' : '&#10060;') . ' Time-sensitive matter understood</div>';

sendEmail(
    adminRecipients(),
    "New Client Intake - $name ($matter)",
    emailLayout('New Client Intake Form', 'Submitted ' . gmdate('F j, Y g:i A') . ' UTC', emailRows([
        'Client Name' => $name, 'Email' => $email, 'Legal Matter' => $matter,
        'Urgency' => URGENCY_LEVELS[$item['urgency']],
        'Preferred Contact' => $item['preferred_contact'] . ' | Best time: ' . ($item['best_time'] ?? 'Not specified'),
        'Case Description' => $item['case_description'],
    ]) . $ackHtml, approvalButtons($email, 'legal'))
);

jsonResponse(['success' => true]);
