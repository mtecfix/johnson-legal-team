<?php
// Build-time check that the trimmed SDK still works: construct each real client and run a request
// through the full middleware stack against an unreachable endpoint (fails at the network, not at autoload).
declare(strict_types=1);
require __DIR__ . '/../vendor/autoload.php';
$common = ['region' => 'us-east-1', 'credentials' => ['key' => 'AKIDEXAMPLE', 'secret' => 'x'],
    'endpoint' => 'http://127.0.0.1:9', 'http' => ['connect_timeout' => 1, 'timeout' => 1], 'retries' => 0];
$calls = [
    [Aws\DynamoDb\DynamoDbClient::class, 'putItem', ['TableName' => 't', 'Item' => ['email' => ['S' => 'a']]]],
    [Aws\Ses\SesClient::class, 'sendEmail', ['Source' => 'a@b.co', 'Destination' => ['ToAddresses' => ['a@b.co']], 'Message' => ['Subject' => ['Data' => 's'], 'Body' => ['Text' => ['Data' => 'b']]]]],
    [Aws\CognitoIdentityProvider\CognitoIdentityProviderClient::class, 'adminCreateUser', ['UserPoolId' => 'p', 'Username' => 'u']],
    [Aws\SecretsManager\SecretsManagerClient::class, 'getSecretValue', ['SecretId' => 's']],
];
foreach ($calls as [$class, $op, $args]) {
    try {
        (new $class($common))->$op($args);
        echo "UNEXPECTED success $class\n"; exit(1);
    } catch (Aws\Exception\AwsException $e) {
        if (!str_contains($e->getMessage(), 'cURL error') && !str_contains($e->getMessage(), 'Connection refused')) { echo "FAIL $class: {$e->getMessage()}\n"; exit(1); }
    } catch (Throwable $e) { echo "FAIL $class: " . get_class($e) . ': ' . $e->getMessage() . "\n"; exit(1); }
}
// Also exercise the default credential chain + endpoint resolution used in Lambda (no network call made).
new Aws\DynamoDb\DynamoDbClient(['region' => 'us-east-1', 'version' => '2012-08-10']);
echo "SDK SMOKE PASSED\n";
