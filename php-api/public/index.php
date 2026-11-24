<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/bootstrap.php';

function itemGet(string $type, string $email, string $submissionId): ?array {
    $key = $type === 'legal'
        ? ['email' => ['S' => $email]]
        : ['email' => ['S' => $email], 'submission_id' => ['S' => $submissionId]];
    $r = aws('ddb')->getItem(['TableName' => tableName($type), 'Key' => $key, 'ConsistentRead' => true]);
    return isset($r['Item']) ? marshaller()->unmarshalItem($r['Item']) : null;
}

function persistIntake(string $type, array $item): void {
    aws('ddb')->putItem([
        'TableName' => tableName($type),
        'Item' => marshaller()->marshalItem(array_filter($item, fn($v) => $v !== null)),
    ]);
}

function decisionKey(string $type, string $email, string $submissionId): array {
    return $type === 'legal'
        ? ['email' => ['S' => $email]]
        : ['email' => ['S' => $email], 'submission_id' => ['S' => $submissionId]];
}

/**
 * Atomically claims a pending decision. Repeating the same action is allowed so
 * a failed Lambda invocation can resume; a competing approve/deny action cannot.
 */
function claimDecision(string $type, string $email, string $submissionId, string $action): void {
    aws('ddb')->updateItem([
        'TableName' => tableName($type),
        'Key' => decisionKey($type, $email, $submissionId),
        'UpdateExpression' => 'SET #s = :processing, decision_action = :action, processing_started_at = :r',
        'ConditionExpression' => '#s = :pending OR (#s = :processing AND decision_action = :action)',
        'ExpressionAttributeNames' => ['#s' => 'status'],
        'ExpressionAttributeValues' => [
            ':pending' => ['S' => 'pending_review'],
            ':processing' => ['S' => 'decision_processing'],
            ':action' => ['S' => $action],
            ':r' => ['S' => nowIso()],
        ],
    ]);
}

/** Finalizes only the action that successfully claimed this exact submission. */
function finalizeDecision(string $type, string $email, string $submissionId, string $action, string $status): void {
    try {
        aws('ddb')->updateItem([
            'TableName' => tableName($type),
            'Key' => decisionKey($type, $email, $submissionId),
            'UpdateExpression' => 'SET #s = :final, reviewed_at = :r REMOVE decision_action, processing_started_at',
            'ConditionExpression' => '#s = :processing AND decision_action = :action',
            'ExpressionAttributeNames' => ['#s' => 'status'],
            'ExpressionAttributeValues' => [
                ':final' => ['S' => $status],
                ':processing' => ['S' => 'decision_processing'],
                ':action' => ['S' => $action],
                ':r' => ['S' => nowIso()],
            ],
        ]);
    } catch (Aws\DynamoDb\Exception\DynamoDbException $e) {
        if ($e->getAwsErrorCode() !== 'ConditionalCheckFailedException') throw $e;
        $current = itemGet($type, $email, $submissionId);
        // A parallel request for the same action may have finalized first.
        if (($current['status'] ?? '') !== $status) throw $e;
    }
}

function submitIntake(string $type): never {
    $data = inputJson();
    required($data, ['email', 'legalMatter', 'urgency', 'caseDescription', 'preferredContact']);
    $email = emailAddress($data);
    $matters = ['estate-planning','probate','personal-injury','criminal-defense','expungement','traffic','other'];
    $urgencies = ['immediate','soon','planning','consultation'];
    $contacts = ['email','phone','text','portal'];
    $matter = oneOf(value($data, 'legalMatter', 40), $matters, 'legalMatter');
    $urgency = oneOf(value($data, 'urgency', 40), $urgencies, 'urgency');
    $contact = oneOf(value($data, 'preferredContact', 20), $contacts, 'preferredContact');
    if ($matter === null || $urgency === null || $contact === null || value($data, 'caseDescription') === null) {
        throw new HttpException('Required intake fields are incomplete', 400);
    }

    $acks = [
        'no_attorney_relationship' => ($data['noAttorneyRelationship'] ?? false) === true,
        'consent_contact' => ($data['consentContact'] ?? false) === true,
        'privacy_policy' => ($data['privacyPolicy'] ?? false) === true,
        'time_sensitive' => ($data['timeSensitive'] ?? false) === true,
    ];
    if ($type === 'legal' && in_array(false, $acks, true)) {
        throw new HttpException('All four legal acknowledgements are required', 400);
    }

    $submissionId = bin2hex(random_bytes(16));
    $item = [
        'email' => $email, 'submission_id' => $submissionId,
        'first_name' => value($data, 'firstName', 100), 'last_name' => value($data, 'lastName', 100),
        'legal_matter' => $matter, 'urgency' => $urgency,
        'case_description' => value($data, 'caseDescription', 5000),
        'preferred_contact' => $contact, 'best_time' => value($data, 'bestTime', 20),
        'referral_source' => value($data, 'referralSource', 200),
        'previous_attorney' => value($data, 'previousAttorney', 200),
        'additional_notes' => value($data, 'additionalNotes', 5000),
        'acknowledgements' => $type === 'legal' ? $acks : null,
        'submitted_at' => nowIso(), 'status' => 'pending_review',
    ];
    persistIntake($type, $item);

    $approve = approvalLink($email, $type, 'approve', $submissionId);
    $deny = approvalLink($email, $type, 'deny', $submissionId);
    $title = $type === 'legal' ? 'New legal intake' : 'New client onboarding';
    try {
        sendEmail(adminEmails(), $title . ' — ' . $email, emailHtml($title, [
            'Email' => $email, 'Legal matter' => $matter, 'Urgency' => $urgency,
            'Description' => (string)$item['case_description'], 'Preferred contact' => $contact,
        ], $approve, $deny));
    } catch (Throwable $e) {
        error_log('[jlt-api] intake saved but admin email failed: ' . $e->getMessage());
        respond(['success' => true, 'notification' => 'failed', 'message' => 'Your intake was saved. Please call the office to confirm receipt.'], 202);
    }
    respond(['success' => true, 'message' => 'Your intake was submitted for review.']);
}

function registerProfile(): never {
    $data = inputJson();
    $auth = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
    if (!preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) throw new HttpException('Sign in is required', 401);
    $identity = aws('cognito')->getUser(['AccessToken' => $m[1]]);
    $attrs = [];
    foreach ($identity['UserAttributes'] ?? [] as $attr) $attrs[$attr['Name']] = $attr['Value'];
    $verifiedEmail = strtolower((string)($attrs['email'] ?? ''));
    $email = emailAddress($data);
    if ($verifiedEmail === '' || $verifiedEmail !== $email || ($attrs['email_verified'] ?? 'false') !== 'true') {
        throw new HttpException('The signed-in account does not match the verified email', 403);
    }
    required($data, ['firstName', 'lastName', 'phone']);
    $item = [
        'email' => $email, 'role' => 'client',
        'first_name' => value($data, 'firstName', 100), 'last_name' => value($data, 'lastName', 100),
        'phone' => value($data, 'phone', 30), 'address' => value($data, 'address', 255),
        'city' => value($data, 'city', 100), 'state' => value($data, 'state', 50),
        'zip_code' => value($data, 'zipCode', 10), 'company_name' => value($data, 'companyName', 255),
        'preferred_contact' => oneOf(value($data, 'preferredContact', 10), ['email','phone','text'], 'preferredContact'),
        'timezone' => value($data, 'timezone', 40), 'registered_at' => nowIso(), 'status' => 'active',
    ];
    try {
        aws('ddb')->putItem([
            'TableName' => tableName('profiles'),
            'Item' => marshaller()->marshalItem(array_filter($item, fn($v) => $v !== null)),
            'ConditionExpression' => 'attribute_not_exists(email)',
        ]);
    } catch (Aws\DynamoDb\Exception\DynamoDbException $e) {
        if ($e->getAwsErrorCode() === 'ConditionalCheckFailedException') respond(['error' => 'User already registered'], 409);
        throw $e;
    }
    respond(['success' => true, 'message' => 'Profile created.']);
}

function approvalPage(string $title, string $body, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
    echo '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
        . h($title) . '</title></head><body style="font:16px Arial;max-width:640px;margin:4rem auto;padding:1rem">'
        . '<h1>' . h($title) . '</h1>' . $body . '</body></html>';
    exit;
}

function approveRegistration(): never {
    $email = strtolower(trim((string)($_GET['email'] ?? '')));
    $type = (string)($_GET['type'] ?? '');
    $action = (string)($_GET['action'] ?? '');
    $id = (string)($_GET['submission_id'] ?? '');
    $expires = filter_var($_GET['expires'] ?? null, FILTER_VALIDATE_INT);
    $token = (string)($_GET['token'] ?? '');
    if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || !in_array($type, ['legal','client'], true)
        || !in_array($action, ['approve','deny'], true) || !preg_match('/^[a-f0-9]{32}$/', $id)
        || !$expires || $expires < time() || $expires > time() + 172800
        || !hash_equals(approvalToken($email, $type, $action, $id, $expires), $token)) {
        approvalPage('Invalid or expired approval link', '<p>Request a new approval link from the system administrator.</p>', 403);
    }

    $record = itemGet($type, $email, $id);
    $status = $record['status'] ?? '';
    $resumable = $status === 'decision_processing' && ($record['decision_action'] ?? '') === $action;
    if (!$record || ($record['submission_id'] ?? '') !== $id
        || ($status !== 'pending_review' && !$resumable)) {
        approvalPage('Submission already handled', '<p>This intake is no longer pending review.</p>', 409);
    }

    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        $label = $action === 'approve' ? 'Approve' : 'Deny';
        approvalPage($label . ' intake', '<p>Confirm the ' . strtolower($label) . ' decision for <strong>' . h($email) . '</strong>.</p>'
            . '<form method="post"><button type="submit">' . $label . ' submission</button></form>');
    }

    // Claim before any external side effects. If the Lambda fails mid-operation,
    // the same signed link can resume the same action without allowing the opposite decision.
    try {
        claimDecision($type, $email, $id, $action);
    } catch (Aws\DynamoDb\Exception\DynamoDbException $e) {
        if ($e->getAwsErrorCode() === 'ConditionalCheckFailedException') {
            approvalPage('Submission already handled', '<p>A decision is already being processed or has been recorded.</p>', 409);
        }
        throw $e;
    }

    if ($action === 'approve') {
        $attributes = [
            ['Name' => 'email', 'Value' => $email],
            ['Name' => 'email_verified', 'Value' => 'true'],
        ];
        if (!empty($record['first_name'])) $attributes[] = ['Name' => 'given_name', 'Value' => $record['first_name']];
        if (!empty($record['last_name'])) $attributes[] = ['Name' => 'family_name', 'Value' => $record['last_name']];
        try {
            aws('cognito')->adminCreateUser([
                'UserPoolId' => cfg('COGNITO_USER_POOL_ID'), 'Username' => $email,
                'UserAttributes' => $attributes, 'DesiredDeliveryMediums' => ['EMAIL'],
            ]);
        } catch (Aws\CognitoIdentityProvider\Exception\CognitoIdentityProviderException $e) {
            if ($e->getAwsErrorCode() !== 'UsernameExistsException') throw $e;
        }

        try {
            aws('ddb')->putItem([
                'TableName' => tableName('profiles'),
                'Item' => marshaller()->marshalItem([
                    'email' => $email, 'role' => 'client',
                    'first_name' => $record['first_name'] ?? '',
                    'last_name' => $record['last_name'] ?? '',
                    'registered_at' => nowIso(), 'status' => 'active',
                    'source' => $type . '_onboarding',
                ]),
                'ConditionExpression' => 'attribute_not_exists(email)',
            ]);
        } catch (Aws\DynamoDb\Exception\DynamoDbException $e) {
            if ($e->getAwsErrorCode() !== 'ConditionalCheckFailedException') throw $e;
        }
        finalizeDecision($type, $email, $id, $action, 'approved');
    } else {
        finalizeDecision($type, $email, $id, $action, 'denied');
        try {
            sendEmail([$email], 'Registration update — Johnson Legal Team',
                '<p>Thank you for your interest. After review, we are unable to approve portal access at this time.</p>');
        } catch (Throwable $e) {
            error_log('[jlt-api] denial saved; client notification failed: ' . $e->getMessage());
        }
    }

    approvalPage('Decision recorded', '<p>The submission for <strong>' . h($email) . '</strong> was ' . h($action) . 'd.</p>'
        . ($action === 'approve' ? '<p>Cognito account invitation was requested. If the account already existed, no duplicate was created.</p>' : ''));
}

try {
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    if ($path === '/api/health') respond(['ok' => true, 'service' => 'jlt-php-api']);
    if ($path === '/api/legal-onboarding.php') submitIntake('legal');
    if ($path === '/api/onboarding.php') submitIntake('client');
    if ($path === '/api/user-registration.php') registerProfile();
    if ($path === '/api/approve-registration.php') approveRegistration();
    respond(['error' => 'Not found'], 404);
} catch (HttpException $e) {
    respond(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('[jlt-api] ' . ($_SERVER['REQUEST_METHOD'] ?? '?') . ' request failed: ' . $e->getMessage());
    respond(['error' => 'Server error. Please call the office.'], 500);
}
