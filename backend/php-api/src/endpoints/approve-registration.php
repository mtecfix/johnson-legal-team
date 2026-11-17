<?php
/**
 * GET  /api/approve-registration.php?type=legal|client&email=&action=approve|deny&token=  -> confirmation page
 * POST same URL                                                                          -> apply the decision
 *
 * The token is an HMAC of email:type:action, so only links from the admin email work.
 * Approve: mark the intake approved, create the client's Cognito login (Cognito emails the client a
 * temporary password), and create their profile. Deny: mark denied and email the client.
 */
declare(strict_types=1);

$email = strtolower(trim((string) ($_GET['email'] ?? '')));
$type = (string) ($_GET['type'] ?? '');
$action = (string) ($_GET['action'] ?? '');
$token = (string) ($_GET['token'] ?? '');

function page(string $title, string $body, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex');
    header("Content-Security-Policy: default-src 'none'; style-src https://cdn.jsdelivr.net; form-action 'self'");
    echo '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>' . h($title) . '</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">'
        . '</head><body><div class="container mt-5"><div class="row justify-content-center"><div class="col-md-7"><div class="card">'
        . '<div class="card-header"><h3 class="h5 mb-0">' . h($title) . '</h3></div><div class="card-body">' . $body
        . '</div></div></div></div></div></body></html>';
    exit;
}

$validEmail = filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
if (!$validEmail || !in_array($type, ['legal', 'client'], true) || !in_array($action, ['approve', 'deny'], true)
    || !hash_equals(makeHmacToken($email, $type, $action), $token)) {
    page('Invalid link', '<div class="alert alert-danger mb-0">This approval link is invalid or incomplete.</div>', 403);
}

$verb = $action === 'approve' ? 'Approve' : 'Deny';
$label = $type === 'legal' ? 'legal intake' : 'client onboarding';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $button = $action === 'approve' ? 'btn-success' : 'btn-danger';
    page("$verb registration", '<p>' . $verb . ' the ' . h($label) . ' for <strong>' . h($email) . '</strong>?</p>'
        . '<form method="POST"><button type="submit" class="btn ' . $button . '">' . $verb . ' registration</button></form>');
}

$newStatus = $action === 'approve' ? 'approved' : 'denied';
$reviewedAt = nowIso();
$updated = 0;
$firstName = null;
$lastName = null;

if ($type === 'legal') {
    try {
        $result = db()->updateItem([
            'TableName' => table('legal_onboarding'),
            'Key' => ['email' => ['S' => $email]],
            'UpdateExpression' => 'SET #s = :s, reviewed_at = :r',
            'ConditionExpression' => '#s = :pending',
            'ExpressionAttributeNames' => ['#s' => 'status'],
            'ExpressionAttributeValues' => [':s' => ['S' => $newStatus], ':r' => ['S' => $reviewedAt], ':pending' => ['S' => 'pending_review']],
            'ReturnValues' => 'ALL_NEW',
        ]);
        $record = marshaler()->unmarshalItem($result['Attributes']);
        $firstName = $record['first_name'] ?? null;
        $lastName = $record['last_name'] ?? null;
        $updated = 1;
    } catch (Aws\DynamoDb\Exception\DynamoDbException $e) {
        if ($e->getAwsErrorCode() !== 'ConditionalCheckFailedException') {
            throw $e;
        }
    }
} else {
    $pending = db()->query([
        'TableName' => table('client_onboarding'),
        'KeyConditionExpression' => 'email = :e',
        'FilterExpression' => '#s = :pending',
        'ExpressionAttributeNames' => ['#s' => 'status'],
        'ExpressionAttributeValues' => [':e' => ['S' => $email], ':pending' => ['S' => 'pending']],
    ]);
    foreach ($pending['Items'] ?? [] as $row) {
        db()->updateItem([
            'TableName' => table('client_onboarding'),
            'Key' => ['email' => $row['email'], 'submission_id' => $row['submission_id']],
            'UpdateExpression' => 'SET #s = :s, reviewed_at = :r',
            'ExpressionAttributeNames' => ['#s' => 'status'],
            'ExpressionAttributeValues' => [':s' => ['S' => $newStatus], ':r' => ['S' => $reviewedAt]],
        ]);
        $updated++;
    }
}

if ($updated === 0) {
    page('Already handled', '<div class="alert alert-info mb-0">There is no pending ' . h($label) . ' for '
        . h($email) . '. It may already have been approved or denied.</div>');
}

$notes = [];
if ($action === 'approve') {
    $attributes = [['Name' => 'email', 'Value' => $email], ['Name' => 'email_verified', 'Value' => 'true']];
    if ($firstName) { $attributes[] = ['Name' => 'given_name', 'Value' => $firstName]; }
    if ($lastName) { $attributes[] = ['Name' => 'family_name', 'Value' => $lastName]; }
    try {
        // Cognito emails the client their username and a temporary password (works for any address).
        Services::get('cognito')->adminCreateUser([
            'UserPoolId' => env('COGNITO_USER_POOL_ID'),
            'Username' => $email,
            'UserAttributes' => $attributes,
            'DesiredDeliveryMediums' => ['EMAIL'],
        ]);
        $notes[] = 'A portal login was created. Cognito emailed the client a temporary password.';
    } catch (Aws\CognitoIdentityProvider\Exception\CognitoIdentityProviderException $e) {
        if ($e->getAwsErrorCode() !== 'UsernameExistsException') {
            throw $e;
        }
        $notes[] = 'The client already had a portal login; no new invitation was sent.';
    }
    try {
        db()->putItem([
            'TableName' => table('user_profiles'),
            'Item' => marshaler()->marshalItem(array_filter([
                'email' => $email, 'role' => 'client', 'first_name' => $firstName, 'last_name' => $lastName,
                'registered_at' => $reviewedAt, 'status' => 'active', 'source' => $type . '_onboarding',
            ], fn ($v) => $v !== null)),
            'ConditionExpression' => 'attribute_not_exists(email)',
        ]);
    } catch (Aws\DynamoDb\Exception\DynamoDbException $e) {
        if ($e->getAwsErrorCode() !== 'ConditionalCheckFailedException') {
            throw $e;
        }
    }
} else {
    try {
        sendEmail([$email], 'Registration Update - Johnson Legal Team', emailLayout('Registration Update', 'Johnson Legal Team',
            '<p>Thank you for your interest in Johnson Legal Team. After review, we are unable to approve portal access at this time.</p>'
            . '<p>If you have questions, please call us at ' . FIRM_PHONE . '.</p>'));
        $notes[] = 'The client was emailed.';
    } catch (Aws\Exception\AwsException $e) {
        // SES sandbox rejects unverified recipients; the decision is still saved.
        error_log('[jlt-api] deny email not sent to client: ' . $e->getAwsErrorCode());
        $notes[] = 'The client could not be emailed automatically (' . h((string) $e->getAwsErrorCode()) . '). Please contact them directly.';
    }
}

page("Registration {$newStatus}", '<div class="alert alert-success">The ' . h($label) . ' for <strong>' . h($email)
    . '</strong> was ' . $newStatus . '.</div><p class="mb-0">' . implode('<br>', array_map('h', $notes)) . '</p>');
