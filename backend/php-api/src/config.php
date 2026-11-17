<?php
/**
 * Shared configuration and helpers for the JLT form API.
 * Replaces the missing config.php the original PHP endpoints required (MySQL -> DynamoDB, mail() -> SES).
 * All configuration comes from Lambda environment variables; the HMAC secret comes from Secrets Manager.
 */
declare(strict_types=1);

use Aws\CognitoIdentityProvider\CognitoIdentityProviderClient;
use Aws\DynamoDb\DynamoDbClient;
use Aws\DynamoDb\Marshaler;
use Aws\SecretsManager\SecretsManagerClient;
use Aws\Ses\SesClient;

require_once __DIR__ . '/../vendor/autoload.php';

final class HttpError extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 400)
    {
        parent::__construct($message);
    }
}

function env(string $name, ?string $default = null): string
{
    $value = getenv($name);
    if ($value === false || $value === '') {
        if ($default === null) {
            throw new RuntimeException("Missing environment variable $name");
        }
        return $default;
    }
    return $value;
}

define('AWS_REGION_NAME', env('AWS_REGION', 'us-east-1'));
define('SITE_URL', rtrim(env('SITE_URL', 'https://johnsonlegalteam.org'), '/'));
define('FROM_EMAIL', env('FROM_EMAIL', 'Johnson Legal Team <webmaster@johnsonlegalteam.org>'));
define('ADMIN_EMAILS', env('ADMIN_EMAILS', 'johnsonlegalteam@gmail.com'));
define('FIRM_PHONE', '(833) 659-8378');
define('MAX_BODY_BYTES', 32 * 1024);

/** Service container. Tests replace entries with fakes; production builds real AWS clients lazily. */
final class Services
{
    /** @var array<string, mixed> */
    public static array $overrides = [];
    /** @var array<string, mixed> */
    private static array $cache = [];

    public static function get(string $name): mixed
    {
        if (array_key_exists($name, self::$overrides)) {
            return self::$overrides[$name];
        }
        return self::$cache[$name] ??= match ($name) {
            'db'      => new DynamoDbClient(['region' => AWS_REGION_NAME, 'version' => '2012-08-10']),
            'ses'     => new SesClient(['region' => AWS_REGION_NAME, 'version' => '2010-12-01']),
            'cognito' => new CognitoIdentityProviderClient(['region' => AWS_REGION_NAME, 'version' => '2016-04-18']),
            'secrets' => new SecretsManagerClient(['region' => AWS_REGION_NAME, 'version' => '2017-10-17']),
            default   => throw new RuntimeException("Unknown service $name"),
        };
    }
}

/** @return DynamoDbClient (a fake with the same methods in tests) */
function db(): object { return Services::get('db'); }

function marshaler(): Marshaler
{
    static $m = null;
    return $m ??= new Marshaler(['nullify_invalid' => true, 'ignore_invalid' => true]);
}

function table(string $logicalName): string
{
    return match ($logicalName) {
        'user_profiles'     => env('TABLE_USER_PROFILES'),
        'legal_onboarding'  => env('TABLE_LEGAL_ONBOARDING'),
        'client_onboarding' => env('TABLE_CLIENT_ONBOARDING'),
    };
}

function nowIso(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

// ---------- HTTP helpers ----------

function sendCorsHeaders(): void
{
    header('Access-Control-Allow-Origin: ' . SITE_URL);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Vary: Origin');
}

function jsonResponse(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    sendCorsHeaders();
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

/** Handle CORS preflight and enforce POST + a JSON body under the size limit. */
function readJsonPost(): array
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'OPTIONS') {
        http_response_code(204);
        sendCorsHeaders();
        exit;
    }
    if ($method !== 'POST') {
        throw new HttpError('Method not allowed', 405);
    }
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if ($raw === false || strlen($raw) > MAX_BODY_BYTES) {
        throw new HttpError('Request too large', 413);
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        throw new HttpError('Invalid JSON data');
    }
    return $data;
}

// ---------- validation ----------

/** Trimmed string field, or null when absent/blank. Throws when longer than $max. */
function field(array $input, string $name, int $max = 200): ?string
{
    if (!isset($input[$name]) || is_array($input[$name])) {
        return null;
    }
    $value = trim((string) $input[$name]);
    if ($value === '') {
        return null;
    }
    if (mb_strlen($value) > $max) {
        throw new HttpError("Field too long: $name");
    }
    return $value;
}

/** @param string[] $names */
function requireFields(array $input, array $names): void
{
    foreach ($names as $name) {
        if (field($input, $name, 10000) === null) {
            throw new HttpError("Missing required field: $name");
        }
    }
}

function normalizeEmail(?string $email): string
{
    $email = strtolower(trim((string) $email));
    if ($email === '' || strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        throw new HttpError('A valid email address is required');
    }
    return $email;
}

/** @param string[] $allowed */
function oneOf(?string $value, array $allowed, string $name): ?string
{
    if ($value !== null && !in_array($value, $allowed, true)) {
        throw new HttpError("Invalid value for $name");
    }
    return $value;
}

function h(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

const LEGAL_MATTERS = [
    'estate-planning' => 'Estate Planning', 'probate' => 'Probate Administration',
    'personal-injury' => 'Personal Injury', 'criminal-defense' => 'Criminal Defense',
    'expungement' => 'Criminal Record Expungement', 'traffic' => 'Traffic Violations', 'other' => 'Other',
];
const URGENCY_LEVELS = [
    'immediate' => 'Immediate (within 1 week)', 'soon' => 'Soon (within 1 month)',
    'planning' => 'Planning ahead (no rush)', 'consultation' => 'Need case discussion',
];
const CONTACT_METHODS = ['email', 'phone', 'text', 'portal'];
const BEST_TIMES = ['morning', 'afternoon', 'evening', 'anytime'];

// ---------- approval links ----------

function hmacSecret(): string
{
    static $secret = null;
    if ($secret === null) {
        $result = Services::get('secrets')->getSecretValue(['SecretId' => env('HMAC_SECRET_ARN')]);
        $secret = json_decode((string) $result['SecretString'], true)['hmac_secret'] ?? '';
        if (strlen($secret) < 32) {
            throw new RuntimeException('HMAC secret missing or too short');
        }
    }
    return $secret;
}

function makeHmacToken(string $email, string $type, string $action): string
{
    return hash_hmac('sha256', "$email:$type:$action", hmacSecret());
}

function approvalUrl(string $email, string $type, string $action): string
{
    return SITE_URL . '/api/approve-registration.php?' . http_build_query([
        'type' => $type, 'email' => $email, 'action' => $action,
        'token' => makeHmacToken($email, $type, $action),
    ]);
}

// ---------- email ----------

/** @param string[] $to */
function sendEmail(array $to, string $subject, string $html, ?string $text = null): void
{
    Services::get('ses')->sendEmail([
        'Source' => FROM_EMAIL,
        'Destination' => ['ToAddresses' => array_values($to)],
        'Message' => [
            'Subject' => ['Data' => $subject, 'Charset' => 'UTF-8'],
            'Body' => [
                'Html' => ['Data' => $html, 'Charset' => 'UTF-8'],
                'Text' => ['Data' => $text ?? trim(strip_tags(str_replace(['<br>', '</p>', '</div>'], "\n", $html))), 'Charset' => 'UTF-8'],
            ],
        ],
    ]);
}

/** @return string[] */
function adminRecipients(): array
{
    return array_values(array_filter(array_map('trim', explode(',', ADMIN_EMAILS))));
}

/** Wraps rows of label/value pairs (already escaped) in the firm's email layout. */
function emailLayout(string $title, string $subtitle, string $bodyHtml, string $actionsHtml = ''): string
{
    $actions = $actionsHtml === '' ? '' : "<div style=\"text-align:center;padding:0 32px 32px\">$actionsHtml</div>";
    return <<<HTML
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px">
<div style="background:#fff;max-width:640px;margin:0 auto;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)">
<div style="background:#1a365d;color:#fff;padding:24px 32px"><h1 style="margin:0;font-size:20px">$title</h1>
<p style="margin:4px 0 0;opacity:.8;font-size:13px">$subtitle</p></div>
<div style="padding:28px 32px">$bodyHtml</div>$actions
<div style="background:#f0f0f0;padding:16px 32px;font-size:12px;color:#888;text-align:center">Johnson Legal Team &bull; 1221 Bowers St, Birmingham, MI 48012 &bull; (833) 659-8378</div>
</div></body></html>
HTML;
}

/** @param array<string, ?string> $rows label => raw value (escaped here) */
function emailRows(array $rows): string
{
    $out = '';
    foreach ($rows as $label => $value) {
        $display = ($value === null || $value === '') ? 'Not specified' : nl2br(h($value));
        $out .= '<div style="margin-bottom:14px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#666">'
            . h($label) . '</div><div style="font-size:15px;color:#111">' . $display . '</div></div>';
    }
    return $out;
}

function approvalButtons(string $email, string $type): string
{
    $approve = h(approvalUrl($email, $type, 'approve'));
    $deny = h(approvalUrl($email, $type, 'deny'));
    return '<p style="color:#555;font-size:13px;margin-bottom:20px">Review the intake above, then approve or deny portal access. '
        . 'Each link opens a confirmation page first.</p>'
        . "<a href=\"$approve\" style=\"display:inline-block;padding:14px 36px;border-radius:5px;font-weight:bold;text-decoration:none;margin:0 8px;background:#16a34a;color:#fff\">&#10003; Approve Access</a>"
        . "<a href=\"$deny\" style=\"display:inline-block;padding:14px 36px;border-radius:5px;font-weight:bold;text-decoration:none;margin:0 8px;background:#dc2626;color:#fff\">&#10007; Deny Access</a>";
}
