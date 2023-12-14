import { AwsClient } from "aws4fetch";

const HOMEPAGE = "https://github.com/mortonprod/git-lfs-s3-proxy";
const EXPIRY = 3600;

const MIME = "application/vnd.git-lfs+json";

const METHOD_FOR = {
  "upload": "PUT",
  "download": "GET",
};

async function sign(s3, bucket, path, method) {
  const info = { method };
  const signed = await s3.sign(
    new Request(`https://${bucket}/${path}?X-Amz-Expires=${EXPIRY}`, info),
    { aws: { signQuery: true } }
  );
  return signed.url;
}

function parseAuthorization(req) {
  const auth = req.headers.get("Authorization");
  if (!auth) {
    throw new Response(null, { status: 401 });
  }

  const [scheme, encoded] = auth.split(" ");
  if (scheme !== "Basic" || !encoded) {
    throw new Response(null, { status: 400 });
  }

  const buffer = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const decoded = new TextDecoder().decode(buffer).normalize();
  const index = decoded.indexOf(":");
  if (index === -1 || /[\0-\x1F\x7F]/.test(decoded)) {
    throw new Response(null, { status: 400 });
  }

  return { user: decoded.slice(0, index), pass: decoded.slice(index + 1) };
}

async function fetch(req, env) {
  const url = new URL(req.url);

  if (url.pathname == "/") {
    if (req.method === "GET") {
      return Response.redirect(HOMEPAGE, 302);
    } else {
      return new Response(null, { status: 405, headers: { "Allow": "GET" } });
    }
  }

  if (!url.pathname.endsWith("/objects/batch")) {
    return new Response(null, { status: 404 });
  }

  if (req.method !== "POST") {
    return new Response(null, { status: 405, headers: { "Allow": "POST" } });
  }

  // in practice, we'd rather not break out-of-spec clients not setting these
  /*if (!req.headers.get("Accept").startsWith(MIME)
    || !req.headers.get("Content-Type").startsWith(MIME)) {
    return new Response(null, { status: 406 });
  }*/

  const { user, pass } = parseAuthorization(req);
  const s3 = new AwsClient({ accessKeyId: user, secretAccessKey: pass });
  const bucket = url.pathname.slice(1, -14);
  const expires_in = env.EXPIRY || EXPIRY;

  const { objects, operation } = await req.json();
  const method = METHOD_FOR[operation];
  const response = JSON.stringify({
    transfer: "basic",
    objects: await Promise.all(objects.map(async ({ oid, size }) => ({
      oid, size,
      authenticated: true,
      actions: {
        [operation]: { href: await sign(s3, bucket, oid, method), expires_in },
      },
    }))),
  });

  return new Response(response, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/vnd.git-lfs+json",
    },
  });
}

export default { fetch };
