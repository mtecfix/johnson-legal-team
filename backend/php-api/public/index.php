<?php
/**
 * Front controller for the Bref FPM runtime. Maps the paths the site already calls
 * (/api/<name>.php) to the endpoint scripts, so no page needs a URL change.
 */
declare(strict_types=1);

require_once __DIR__ . '/../src/config.php';

$routes = [
    '/api/user-registration.php'    => 'user-registration.php',
    '/api/legal-onboarding.php'     => 'legal-onboarding.php',
    '/api/onboarding.php'           => 'onboarding.php',
    '/api/approve-registration.php' => 'approve-registration.php',
    '/api/health'                   => 'health.php',
];

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (!isset($routes[$path])) {
    jsonResponse(['error' => 'Not found'], 404);
}

try {
    require __DIR__ . '/../src/endpoints/' . $routes[$path];
} catch (HttpError $e) {
    jsonResponse(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    // Log the detail server-side; never leak internals to the browser.
    error_log(sprintf('[jlt-api] %s %s: %s in %s:%d', $_SERVER['REQUEST_METHOD'] ?? '?', $path,
        $e->getMessage(), $e->getFile(), $e->getLine()));
    jsonResponse(['error' => 'Server error. Please call (833) 659-8378.'], 500);
}
