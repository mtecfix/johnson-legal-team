-- User profiles table for one-time registration
CREATE TABLE IF NOT EXISTS user_profiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    role ENUM('client', 'admin', 'super_admin') NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(10),
    
    -- Client-specific fields
    company_name VARCHAR(255),
    preferred_contact ENUM('email', 'phone', 'text'),
    timezone VARCHAR(10),
    
    -- Admin-specific fields
    department VARCHAR(100),
    job_title VARCHAR(100),
    permissions JSON,
    
    -- Super admin-specific fields
    access_level ENUM('full', 'limited'),
    emergency_contact VARCHAR(20),
    system_role TEXT,
    
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('active', 'inactive', 'pending') DEFAULT 'active',
    
    INDEX idx_email (email),
    INDEX idx_role (role),
    INDEX idx_status (status)
);
