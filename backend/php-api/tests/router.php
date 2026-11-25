<?php
// php -S router: wires fakes into the real front controller.
putenv('TABLE_USER_PROFILES=users-t'); putenv('TABLE_LEGAL_ONBOARDING=legal-t'); putenv('TABLE_CLIENT_ONBOARDING=client-t');
putenv('HMAC_SECRET_ARN=fake'); putenv('COGNITO_USER_POOL_ID=us-east-1_test'); putenv('ADMIN_EMAILS=admin1@example.com, admin2@example.com');
require __DIR__ . '/../vendor/autoload.php';
require __DIR__ . '/fakes.php';
require_once __DIR__ . '/../src/config.php';
Services::$overrides = ['db' => new FakeDb(), 'ses' => new FakeSes(), 'cognito' => new FakeCognito(), 'secrets' => new FakeSecrets()];
require __DIR__ . '/../public/index.php';
