import type { NextConfig } from "next";
import {securityHeaders} from "./lib/site-security.mjs";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {source:"/:path*",headers:securityHeaders(process.env.NODE_ENV==="production")},
      {source:"/connect/:path*",headers:[
        {key:"Cache-Control",value:"private, no-store"},
        {key:"X-Robots-Tag",value:"noindex, nofollow, noarchive"},
        {key:"Referrer-Policy",value:"no-referrer"},
      ]},
      {source:"/api/setup/:path*",headers:[
        {key:"Cache-Control",value:"private, no-store"},
        {key:"X-Robots-Tag",value:"noindex, nofollow, noarchive"},
        {key:"Referrer-Policy",value:"no-referrer"},
      ]},
    ];
  },
};

export default nextConfig;
