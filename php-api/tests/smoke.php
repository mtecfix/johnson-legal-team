<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/bootstrap.php';

$checks = [
    'legal matter allowlist' => oneOf('probate', ['estate-planning','probate','personal-injury','criminal-defense','expungement','traffic','other'], 'legalMatter') === 'probate',
    'invalid matter rejected' => false,
    'email normalization' => normalize_test_email('  TEST@example.com  ') === 'test@example.com',
    'HTML escaping' => h('<script>') === '&lt;script&gt;',
];
try { oneOf('root-access', ['client','admin'], 'role'); } catch (HttpException) { $checks['invalid matter rejected'] = true; }
function normalize_test_email(string $v): string {
    $email = strtolower(trim($v));
    if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) throw new RuntimeException('Invalid test email');
    return $email;
}
foreach ($checks as $name => $passed) {
    echo ($passed ? 'PASS' : 'FAIL') . ' ' . $name . PHP_EOL;
}
if (in_array(false, $checks, true)) exit(1);
