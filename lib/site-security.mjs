export const PUBLIC_SITE_ORIGIN="https://incidosint.com";
export const HOSTED_SITE_ORIGIN="https://logic-uk-ireland-rescue-vessels.starrycapybara8.chatgpt.site";

// Identity is supplied by Sites, not by form fields or visitor-provided IDs.
export function ownerAllowed(user,ownerEmail) {
  return typeof user?.userId==="string" && user.userId.length>0
    && typeof user.email==="string" && typeof ownerEmail==="string" && ownerEmail.trim().length>0
    && user.email.trim().toLowerCase()===ownerEmail.trim().toLowerCase();
}

export function setupRequestAllowed(request) {
  return [PUBLIC_SITE_ORIGIN,HOSTED_SITE_ORIGIN].includes(request.headers.get("Origin"))
    && /^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type")||"");
}

export function securityHeaders(production=true) {
  const csp=[
    "default-src 'self'","base-uri 'none'","object-src 'none'",
    `script-src 'self' 'unsafe-inline'${production?"":" 'unsafe-eval'"}`,
    "script-src-attr 'none'","style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://api.maptiler.com https://tiles.maps.eox.at https://tile.openstreetmap.org",
    "font-src 'self' data:",`connect-src 'self'${production?"":" ws: wss:"}`,
    "frame-src https://embed.waze.com https://www.waze.com https://experience.arcgis.com",
    "frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com","form-action 'self'",
    ...(production?["upgrade-insecure-requests"]:[]),
  ].join("; ");
  return [
    {key:"Content-Security-Policy",value:csp},
    {key:"X-Content-Type-Options",value:"nosniff"},
    {key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},
    {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()"},
    ...(production?[{key:"Strict-Transport-Security",value:"max-age=15552000"}]:[]),
  ];
}
