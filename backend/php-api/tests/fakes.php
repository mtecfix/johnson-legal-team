<?php
/** File-backed fakes for DynamoDB, SES, Cognito and Secrets Manager (state survives across php -S requests). */
declare(strict_types=1);

use Aws\Command;
use Aws\DynamoDb\Exception\DynamoDbException;
use Aws\CognitoIdentityProvider\Exception\CognitoIdentityProviderException;

const FAKE_STATE = '/tmp/jlt-fake-state.json';

function fakeState(): array { return is_file(FAKE_STATE) ? json_decode(file_get_contents(FAKE_STATE), true) : ['tables' => [], 'emails' => [], 'users' => []]; }
function fakeSave(array $s): void { file_put_contents(FAKE_STATE, json_encode($s)); }

final class FakeDb
{
    private const KEYS = ['users-t' => ['email'], 'legal-t' => ['email'], 'client-t' => ['email', 'submission_id']];
    private function key(string $table, array $item): string
    {
        return implode('|', array_map(fn ($k) => $item[$k]['S'], self::KEYS[$table]));
    }
    private function fail(string $op): never
    {
        throw new DynamoDbException('The conditional request failed', new Command($op), ['code' => 'ConditionalCheckFailedException']);
    }
    public function putItem(array $a): array
    {
        $s = fakeState(); $k = $this->key($a['TableName'], $a['Item']);
        if (($a['ConditionExpression'] ?? '') === 'attribute_not_exists(email)' && isset($s['tables'][$a['TableName']][$k])) { $this->fail('PutItem'); }
        $s['tables'][$a['TableName']][$k] = $a['Item']; fakeSave($s); return [];
    }
    public function updateItem(array $a): array
    {
        $s = fakeState(); $k = $this->key($a['TableName'], $a['Key']);
        $item = $s['tables'][$a['TableName']][$k] ?? null;
        $v = $a['ExpressionAttributeValues'];
        if (isset($a['ConditionExpression']) && (($item['status']['S'] ?? null) !== $v[':pending']['S'])) { $this->fail('UpdateItem'); }
        $item = ($item ?? $a['Key']); $item['status'] = $v[':s']; $item['reviewed_at'] = $v[':r'];
        $s['tables'][$a['TableName']][$k] = $item; fakeSave($s); return ['Attributes' => $item];
    }
    public function query(array $a): array
    {
        $s = fakeState(); $v = $a['ExpressionAttributeValues'];
        $items = array_values(array_filter($s['tables'][$a['TableName']] ?? [], fn ($i) => $i['email']['S'] === $v[':e']['S'] && $i['status']['S'] === $v[':pending']['S']));
        return ['Items' => $items];
    }
}

final class FakeSes
{
    public function sendEmail(array $a): array
    {
        $to = $a['Destination']['ToAddresses'];
        foreach ($to as $addr) {
            if (str_ends_with($addr, '@unverified.test')) {
                throw new Aws\Ses\Exception\SesException('Email address is not verified.', new Command('SendEmail'), ['code' => 'MessageRejected']);
            }
        }
        $s = fakeState(); $s['emails'][] = ['to' => $to, 'subject' => $a['Message']['Subject']['Data'], 'html' => $a['Message']['Body']['Html']['Data']]; fakeSave($s); return [];
    }
}

final class FakeCognito
{
    public function adminCreateUser(array $a): array
    {
        $s = fakeState();
        if (isset($s['users'][$a['Username']])) {
            throw new CognitoIdentityProviderException('exists', new Command('AdminCreateUser'), ['code' => 'UsernameExistsException']);
        }
        $s['users'][$a['Username']] = $a['UserAttributes']; fakeSave($s); return [];
    }
}

final class FakeSecrets
{
    public function getSecretValue(array $a): array { return ['SecretString' => json_encode(['hmac_secret' => str_repeat('k', 48)])]; }
}
