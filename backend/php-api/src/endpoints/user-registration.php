<?php
/** POST /api/user-registration.php: save a profile (one per email) and notify admins. */
declare(strict_types=1);

$input = readJsonPost();
requireFields($input, ['email', 'role', 'firstName', 'lastName', 'phone']);

$email = normalizeEmail(field($input, 'email', 254));
// The browser sends a role, but it is never trusted: staff roles come from Cognito groups.
$role = 'client';
$item = [
    'email' => $email, 'role' => $role,
    'first_name' => field($input, 'firstName', 100), 'last_name' => field($input, 'lastName', 100),
    'phone' => field($input, 'phone', 30), 'address' => field($input, 'address', 255),
    'city' => field($input, 'city', 100), 'state' => field($input, 'state', 50),
    'zip_code' => field($input, 'zipCode', 10), 'company_name' => field($input, 'companyName', 255),
    'preferred_contact' => oneOf(field($input, 'preferredContact', 10), ['email', 'phone', 'text'], 'preferredContact'),
    'timezone' => field($input, 'timezone', 40),
    'registered_at' => nowIso(), 'status' => 'active',
];

try {
    db()->putItem([
        'TableName' => table('user_profiles'),
        'Item' => marshaler()->marshalItem(array_filter($item, fn ($v) => $v !== null)),
        'ConditionExpression' => 'attribute_not_exists(email)',
    ]);
} catch (Aws\DynamoDb\Exception\DynamoDbException $e) {
    if ($e->getAwsErrorCode() === 'ConditionalCheckFailedException') {
        jsonResponse(['error' => 'User already registered'], 409);
    }
    throw $e;
}

$name = trim($item['first_name'] . ' ' . $item['last_name']);
sendEmail(
    adminRecipients(),
    "New User Registration - $name",
    emailLayout('New User Registration', gmdate('F j, Y g:i A') . ' UTC', emailRows([
        'Name' => $name, 'Email' => $email, 'Role' => 'Client', 'Phone' => $item['phone'],
        'City / State' => trim(($item['city'] ?? '') . ' ' . ($item['state'] ?? '')),
    ]))
);

jsonResponse(['success' => true, 'message' => 'User registered successfully']);
