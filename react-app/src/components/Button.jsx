import { Link } from 'react-router-dom';

export function Button({ children, variant = 'primary', size = 'md', to, href, type = 'button', className = '', ...props }) {
  const classes = ['button', `button--${variant}`, `button--${size}`, className].filter(Boolean).join(' ');
  if (to) return <Link className={classes} to={to} {...props}>{children}</Link>;
  if (href) return <a className={classes} href={href} {...props}>{children}</a>;
  return <button className={classes} type={type} {...props}>{children}</button>;
}
