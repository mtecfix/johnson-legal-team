<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

function checkThrows(callable $callback, string $exceptionClass = HttpException::class): bool
{
    try {
        $callback();
    } catch (Throwable $e) {
        return $e instanceof $exceptionClass;
    }
    return false;
}

$matters = ['estate-planning','probate','personal-injury','criminal-defense','expungement','traffic','other'];
$urgencies = ['immediate','soon','planning','consultation'];
$checks = [
    'legal matter allowlist accepts probate' =>
        oneOf('probate', $matters, 'legalMatter') === 'probate',
    'invalid legal matter is rejected' =>
        checkThrows(fn () => oneOf('not-a-matter', $matters, 'legalMatter')),
    'urgency allowlist accepts immediate' =>
        oneOf('immediate', $urgencies, 'urgency') === 'immediate',
    'invalid urgency is rejected' =>
        checkThrows(fn () => oneOf('whenever', $urgencies, 'urgency')),
    'email is normalized by production validator' =>
        emailAddress(['email' => '  TEST@example.com  ']) === 'test@example.com',
    'invalid email is rejected by production validator' =>
        checkThrows(fn () => emailAddress(['email' => 'not-an-email'])),
    'required fields reject missing values' =>
        checkThrows(fn () => required(['email' => 'test@example.com'], ['email', 'firstName'])),
    'field length limit is enforced' =>
        checkThrows(fn () => value(['description' => 'four'], 'description', 3)),
    'HTML output is escaped' =>
        h('<script>') === '&lt;script&gt;',
];

$failed = false;
foreach ($checks as $name => $passed) {
    echo ($passed ? 'PASS ' : 'FAIL ') . $name . PHP_EOL;
    $failed = $failed || !$passed;
}
if ($failed) {
    exit(1);
}
