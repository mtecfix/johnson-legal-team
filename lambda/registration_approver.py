"""
Lambda: jlt-registration-approver
Triggered by API Gateway POST /approve-registration
Body: { "token": "<hmac_token>", "email": "<client_email>", "action": "approve"|"deny" }

Environment variables required:
  HMAC_SECRET       - shared secret used to sign approval tokens
  DB_HOST           - RDS endpoint
  DB_NAME           - johnson_legal
  DB_USER           - admin
  DB_PASS           - (from Secrets Manager ideally)
  SES_FROM_EMAIL    - noreply@johnsonlegalteam.com
  PORTAL_URL        - https://d1rqv10nry9s54.cloudfront.net
  ADMIN_EMAILS      - comma-separated admin emails
"""

import os
import json
import hmac
import hashlib
import boto3
import pymysql
from datetime import datetime

DB_CONFIG = {
    'host':   os.environ['DB_HOST'],
    'db':     os.environ['DB_NAME'],
    'user':   os.environ['DB_USER'],
    'passwd': os.environ['DB_PASS'],
    'charset': 'utf8mb4',
    'cursorclass': pymysql.cursors.DictCursor
}

ses    = boto3.client('ses', region_name='us-east-1')
FROM   = os.environ['SES_FROM_EMAIL']
PORTAL = os.environ['PORTAL_URL']
SECRET = os.environ['HMAC_SECRET'].encode()


def verify_token(email: str, action: str, token: str) -> bool:
    expected = hmac.new(SECRET, f"{email}:{action}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, token)


def make_token(email: str, action: str) -> str:
    return hmac.new(SECRET, f"{email}:{action}".encode(), hashlib.sha256).hexdigest()


def get_db():
    return pymysql.connect(**DB_CONFIG)


def lambda_handler(event, context):
    try:
        body = json.loads(event.get('body', '{}'))
    except Exception:
        return _resp(400, 'Invalid JSON')

    email  = (body.get('email') or '').strip().lower()
    action = (body.get('action') or '').strip().lower()
    token  = (body.get('token') or '').strip()

    if not email or action not in ('approve', 'deny') or not token:
        return _resp(400, 'Missing required fields')

    if not verify_token(email, action, token):
        return _resp(403, 'Invalid or expired approval token')

    conn = get_db()
    try:
        with conn.cursor() as cur:
            # Check record exists and is still pending
            cur.execute(
                "SELECT id, first_name, last_name FROM legal_onboarding WHERE email = %s AND status = 'pending_review' ORDER BY submitted_at DESC LIMIT 1",
                (email,)
            )
            row = cur.fetchone()
            if not row:
                return _resp(409, 'No pending record found for this email — may already be processed.')

            new_status = 'approved' if action == 'approve' else 'denied'
            cur.execute(
                "UPDATE legal_onboarding SET status = %s, reviewed_at = %s WHERE id = %s",
                (new_status, datetime.utcnow(), row['id'])
            )

            if action == 'approve':
                # Create user_profiles record so cms-api.php can find the user
                cur.execute(
                    """INSERT INTO user_profiles (email, first_name, last_name, role, status, created_at)
                       VALUES (%s, %s, %s, 'client', 'active', %s)
                       ON DUPLICATE KEY UPDATE status = 'active', role = 'client'""",
                    (email, row['first_name'] or '', row['last_name'] or '', datetime.utcnow())
                )

        conn.commit()
    finally:
        conn.close()

    _send_client_email(email, action, row.get('first_name', 'Client'))

    html = _confirmation_html(email, action)
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'text/html'},
        'body': html
    }


def _send_client_email(email: str, action: str, first_name: str):
    if action == 'approve':
        subject = 'Your Johnson Legal Team Account is Approved!'
        body_html = f"""
        <p>Dear {first_name},</p>
        <p>Your account has been approved. You can now log in to your client portal:</p>
        <p><a href="{PORTAL}/client-login.html" style="background:#1a365d;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;">
            Log In to Your Portal
        </a></p>
        <p>Johnson Legal Team<br>(313) 355-2216</p>
        """
    else:
        subject = 'Update on Your Johnson Legal Team Registration'
        body_html = f"""
        <p>Dear {first_name},</p>
        <p>Thank you for your interest in Johnson Legal Team. After reviewing your intake form,
        we are unable to proceed with your registration at this time.</p>
        <p>If you have questions, please call us at (313) 355-2216.</p>
        <p>Johnson Legal Team</p>
        """

    ses.send_email(
        Source=FROM,
        Destination={'ToAddresses': [email]},
        Message={
            'Subject': {'Data': subject},
            'Body':    {'Html': {'Data': body_html}}
        }
    )


def _confirmation_html(email: str, action: str) -> str:
    color  = '#16a34a' if action == 'approve' else '#dc2626'
    label  = 'Approved' if action == 'approve' else 'Denied'
    return f"""<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
    <h2 style="color:{color}">Registration {label}</h2>
    <p><strong>{email}</strong> has been {label.lower()}.</p>
    <p>The client has been notified by email.</p>
    </body></html>"""


def _resp(code: int, msg: str):
    return {'statusCode': code, 'body': json.dumps({'error': msg})}
