<?php
declare(strict_types=1);

use Aws\CognitoIdentityProvider\CognitoIdentityProviderClient;
use Aws\DynamoDb\DynamoDbClient;
use Aws\DynamoDb\Marshaler;
use Aws\SecretsManager\SecretsManagerClient;
use Aws\Ses\SesClient;

require_once dirname(__DIR__) . '/vendor/autoload.php';

function cfg(string $key, ?string $default = null): string {
    $value = getenv($key);
    if ($value === false || $value === '') {
        if ($default === null) throw new RuntimeException("Missing environment variable: $key");
        return $default;
    }
    return $value;
}

function aws(string $service): object {
    static $clients = [];
    if (isset($clients[$service])) return $clients[$service];
    $region = cfg('AWS_REGION', 'us-east-1');
    return $clients[$service] = match ($service) {
        'ddb' => new DynamoDbClient(['version' => 'latest', 'region' => $region]),
        'ses' => new SesClient(['version' => 'latest', 'region' => $region]),
        'cognito' => new CognitoIdentityProviderClient(['version' => 'latest', 'region' => $region]),
        'secrets' => new SecretsManagerClient(['version' => 'latest', 'region' => $region]),
        default => throw new InvalidArgumentException('Unknown AWS service'),
    };
}

function marshaller(): Marshaler {
    static $m;
    return $m ??= new Marshaler(['nullify_invalid' => true, 'ignore_invalid' => true]);
}

function tableName(string $name): string {
    return match ($name) {
        'legal' => cfg('TABLE_LEGAL_ONBOARDING'),
        'client' => cfg('TABLE_CLIENT_ONBOARDING'),
        'profiles' => cfg('TABLE_USER_PROFILES'),
        default => throw new InvalidArgumentException('Unknown table'),
    };
}

function nowIso(): string { return gmdate('Y-m-d\TH:i:s\Z'); }
function h(string $v): string { return htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }

function cors(): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = array_filter(array_map('trim', explode(',', cfg(
        'CORS_ORIGINS',
        'https://johnsonlegalteam.org,https://www.johnsonlegalteam.org'
    ))));
    if ($origin !== '' && in_array($origin, $allowed, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
}

function respond(array $body, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    cors();
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function inputJson(): array {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
        http_response_code(204); cors(); exit;
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') throw new HttpException('Method not allowed', 405);
    $raw = file_get_contents('php://input', false, null, 0, 32769);
    if ($raw === false || strlen($raw) > 32768) throw new HttpException('Request too large', 413);
    $data = json_decode($raw, true);
    if (!is_array($data)) throw new HttpException('Invalid JSON body', 400);
    return $data;
}

function value(array $data, string $key, int $max = 5000): ?string {
    if (!isset($data[$key]) || is_array($data[$key]) || is_object($data[$key])) return null;
    $v = trim((string)$data[$key]);
    if ($v === '') return null;
    if (mb_strlen($v) > $max) throw new HttpException("Field too long: $key", 400);
    return $v;
}

function required(array $data, array $keys): void {
    foreach ($keys as $key) if (value($data, $key, 5000) === null) throw new HttpException("Missing required field: $key", 400);
}

function emailAddress(array $data): string {
    $email = strtolower(trim((string)($data['email'] ?? '')));
    if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        throw new HttpException('A valid email address is required', 400);
    }
    return $email;
}

function oneOf(?string $v, array $allowed, string $field): ?string {
    if ($v !== null && !in_array($v, $allowed, true)) throw new HttpException("Invalid value for $field", 400);
    return $v;
}

function hmacSecret(): string {
    static $secret;
    if ($secret !== null) return $secret;
    $result = aws('secrets')->getSecretValue(['SecretId' => cfg('HMAC_SECRET_ARN')]);
    $decoded = json_decode((string)$result['SecretString'], true);
    $secret = (string)($decoded['hmac_secret'] ?? '');
    if (strlen($secret) < 32) throw new RuntimeException('Approval signing key is not configured');
    return $secret;
}

function approvalToken(string $email, string $type, string $action, string $submissionId, int $expires): string {
    $message = implode('|', [$email, $type, $action, $submissionId, (string)$expires]);
    return hash_hmac('sha256', $message, hmacSecret());
}

function approvalLink(string $email, string $type, string $action, string $submissionId): string {
    $expires = time() + 172800;
    $params = [
        'type' => $type, 'email' => $email, 'action' => $action,
        'submission_id' => $submissionId, 'expires' => $expires,
    ];
    $params['token'] = approvalToken($email, $type, $action, $submissionId, $expires);
    return rtrim(cfg('SITE_URL', 'https://johnsonlegalteam.org'), '/') . '/api/approve-registration.php?' . http_build_query($params);
}

function sendEmail(array $to, string $subject, string $html): void {
    aws('ses')->sendEmail([
        'Source' => cfg('FROM_EMAIL', 'webmaster@johnsonlegalteam.org'),
        'Destination' => ['ToAddresses' => array_values($to)],
        'Message' => [
            'Subject' => ['Data' => $subject, 'Charset' => 'UTF-8'],
            'Body' => ['Html' => ['Data' => $html, 'Charset' => 'UTF-8']],
        ],
    ]);
}

function adminEmails(): array {
    return array_values(array_filter(array_map('trim', explode(',', cfg('ADMIN_EMAILS', 'johnsonlegalteam@gmail.com')))));
}

function emailHtml(string $title, array $rows, string $approve, string $deny): string {
    $body = '';
    foreach ($rows as $label => $text) {
        $body .= '<p><strong>' . h($label) . ':</strong><br>' . nl2br(h((string)$text)) . '</p>';
    }
    return '<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:640px;margin:auto">'
        . '<h2>' . h($title) . '</h2>' . $body
        . '<p><a href="' . h($approve) . '">Review and approve</a> &nbsp;|&nbsp; <a href="' . h($deny) . '">Review and deny</a></p>'
        . '<p>Opening a link does not apply the decision. A confirmation is required.</p></body></html>';
}

class HttpException extends RuntimeException {
    public function __construct(string $message, public readonly int $status = 400) { parent::__construct($message); }
}
