import {Mail, Phone} from 'lucide-react';

export function copyrightNotice() {
  return `© ${new Date().getFullYear()} Ammar Sayed. All rights reserved.`;
}

/** Site footer with the developer's copyright and contact details, shared by the booking and admin pages. */
export function SiteFooter({className}: {className?: string}) {
  return <footer className={className}>
    <span>Egybell · Human Resources</span>
    <span className="credits">
      <span>{copyrightNotice()}</span>
      <span>Designed & developed by Ammar Sayed</span>
      <a href="mailto:ammarsayed1988@gmail.com"><Mail size={12} aria-hidden="true"/>ammarsayed1988@gmail.com</a>
      <a href="tel:+201069769196"><Phone size={12} aria-hidden="true"/><span dir="ltr">+20 106 976 9196</span></a>
    </span>
  </footer>;
}
