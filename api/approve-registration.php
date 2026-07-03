<?php
require_once '../config.php';

$email = $_GET['email'] ?? '';
$action = $_GET['action'] ?? '';

if (!$email || !in_array($action, ['approve', 'deny'])) {
    die('Invalid approval link');
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        // Update onboarding status
        $stmt = $pdo->prepare("UPDATE client_onboarding SET status = ?, reviewed_at = NOW() WHERE email = ?");
        $stmt->execute([$action === 'approve' ? 'approved' : 'denied', $email]);
        
        // Send notification email to client
        $subject = $action === 'approve' ? 'Account Approved - Johnson Legal Team' : 'Registration Update - Johnson Legal Team';
        
        if ($action === 'approve') {
            $message = "Your account has been approved! You can now log in to your client portal at: " . $_SERVER['HTTP_HOST'] . "/client-login.html";
        } else {
            $message = "Thank you for your interest. After review, we are unable to approve your registration at this time.";
        }
        
        mail($email, $subject, $message);
        
        $success = true;
    } catch (Exception $e) {
        $error = "Error processing approval: " . $e->getMessage();
    }
}
?>
<!DOCTYPE html>
<html>
<head>
    <title>Registration Approval</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body>
    <div class="container mt-5">
        <div class="row justify-content-center">
            <div class="col-md-6">
                <div class="card">
                    <div class="card-header">
                        <h3>Registration <?= ucfirst($action) ?></h3>
                    </div>
                    <div class="card-body">
                        <?php if (isset($success)): ?>
                            <div class="alert alert-success">
                                Registration <?= $action ?>d successfully! Client has been notified.
                            </div>
                        <?php elseif (isset($error)): ?>
                            <div class="alert alert-danger"><?= $error ?></div>
                        <?php else: ?>
                            <p>Are you sure you want to <?= $action ?> registration for: <strong><?= htmlspecialchars($email) ?></strong>?</p>
                            <form method="POST">
                                <button type="submit" class="btn btn-<?= $action === 'approve' ? 'success' : 'danger' ?>">
                                    <?= ucfirst($action) ?> Registration
                                </button>
                                <a href="../admin/manage-clients.php" class="btn btn-secondary">Cancel</a>
                            </form>
                        <?php endif; ?>
                    </div>
                </div>
            </div>
        </div>
    </div>
</body>
</html>
