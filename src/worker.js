async function getAdminSessionToken(secret) {
  const data = new TextEncoder().encode("27busan-admin:" + secret);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(hash)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function isAdmin(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const expected = await getAdminSessionToken(env.ADMIN_PASSWORD);

  return cookie
    .split(";")
    .map(x => x.trim())
    .some(x => x === `admin_session=${expected}`);
}

function loginPage(error = "") {
  return new Response(`
<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>27Busan｜管理員登入</title>

<style>
  *{box-sizing:border-box}

  body{
    margin:0;
    min-height:100vh;
    display:grid;
    place-items:center;
    background:#f5f7fb;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft JhengHei",Arial,sans-serif;
    color:#1f2937;
  }

  .login{
    width:min(400px,calc(100% - 32px));
    background:#fff;
    padding:28px;
    border:1px solid #dfe3ea;
    border-radius:16px;
    box-shadow:0 12px 35px rgba(15,23,42,.08);
  }

  h1{
    margin:0 0 6px;
    font-size:24px;
  }

  p{
    margin:0 0 20px;
    color:#6b7280;
    font-size:14px;
  }

  label{
    display:block;
    font-weight:700;
    font-size:13px;
    margin-bottom:6px;
  }

  input{
    width:100%;
    padding:11px 12px;
    border:1px solid #dfe3ea;
    border-radius:9px;
    font:inherit;
  }

  button{
    width:100%;
    margin-top:14px;
    padding:11px;
    border:0;
    border-radius:9px;
    background:#2563eb;
    color:#fff;
    font:inherit;
    font-weight:700;
    cursor:pointer;
  }

  .error{
    margin-bottom:14px;
    padding:9px 10px;
    background:#fef2f2;
    color:#b91c1c;
    border-radius:8px;
    font-size:13px;
  }
</style>
</head>

<body>

  <form class="login" method="POST" action="/api/admin/login">

    <h1>🏨 27Busan 後台</h1>
    <p>請輸入管理密碼</p>

    ${error ? `<div class="error">${error}</div>` : ""}

    <label>管理密碼</label>
    <input
      name="password"
      type="password"
      autocomplete="current-password"
      required
      autofocus
    >

    <button type="submit">登入</button>

  </form>

</body>
</html>
`, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}


// =========================
// 投票者身分 Cookie
// =========================
async function signVoterId(voterId, secret) {
  if (!secret) {
    throw new Error("VOTER_SESSION_SECRET 未設定");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(String(voterId))
  );

  return [...new Uint8Array(signature)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";

  for (const part of cookie.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");

    if (key === name) {
      return valueParts.join("=");
    }
  }

  return null;
}

async function createVoterSession(voterId, env) {
  const signature = await signVoterId(
    voterId,
    env.VOTER_SESSION_SECRET
  );

  return `${voterId}.${signature}`;
}

async function getCurrentVoter(request, env) {
  const token = getCookie(request, "voter_session");

  if (!token) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const voterId = Number(parts[0]);
  const receivedSignature = parts[1];

  if (!Number.isInteger(voterId) || voterId <= 0) {
    return null;
  }

  const expectedSignature = await signVoterId(
    voterId,
    env.VOTER_SESSION_SECRET
  );

  if (receivedSignature !== expectedSignature) {
    return null;
  }

  const voter = await env.DB.prepare(`
    SELECT id, name
    FROM voters
    WHERE id = ?
      AND is_active = 1
  `)
    .bind(voterId)
    .first();

  return voter || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // -------------------------
    // 管理員登入
    // -------------------------
    if (
      url.pathname === "/api/admin/login" &&
      request.method === "POST"
    ) {
      const form = await request.formData();
      const password = String(form.get("password") || "");

      if (password !== env.ADMIN_PASSWORD) {
        return loginPage("密碼錯誤");
      }

      const token = await getAdminSessionToken(env.ADMIN_PASSWORD);

      return new Response(null, {
        status: 303,
        headers: {
          "Location": "/admin.html",
          "Set-Cookie":
            `admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`
        }
      });
    }

    // -------------------------
    // 保護 admin.html
    // -------------------------
    if (
  url.pathname === "/admin" ||
  url.pathname === "/admin.html"
) {
  if (!(await isAdmin(request, env))) {
    return loginPage();
  }

  return env.ASSETS.fetch(request);
}

    // -------------------------
    // 保護未來所有 admin API
    // -------------------------
    if (url.pathname.startsWith("/api/admin/")) {
      if (!(await isAdmin(request, env))) {
        return Response.json(
          {
            ok: false,
            message: "Unauthorized"
          },
          {
            status: 401
          }
        );
      }
    }
    // -------------------------
// 新增地點
// -------------------------
if (
  url.pathname === "/api/admin/places" &&
  request.method === "POST"
) {
  try {
    const body = await request.json();

    if (!body.name || !String(body.name).trim()) {
      return Response.json(
        {
          ok: false,
          message: "名稱不能空白"
        },
        {
          status: 400
        }
      );
    }

    const emptyToNull = value => {
      if (value === undefined || value === null || value === "") {
        return null;
      }
      return value;
    };

    const numberOrNull = value => {
      if (value === undefined || value === null || value === "") {
        return null;
      }

      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const boolOrNull = value => {
      if (value === undefined || value === null || value === "") {
        return null;
      }

      return value ? 1 : 0;
    };

    const result = await env.DB.prepare(`
      INSERT INTO places (
        type,
        name,
        area,
        platform,
        url,
        map_url,
        lat,
        lng,
        rating,
        rating_max,
        review_count,
        total_price,
        bedrooms,
        bed_description,
        has_kitchen,
        has_living_room,
        has_elevator,
        cancel_policy,
        note,
        image_url,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, CURRENT_TIMESTAMP
      )
    `).bind(
      body.type || "hotel",
      String(body.name).trim(),
      emptyToNull(body.area),
      emptyToNull(body.platform),

      emptyToNull(body.bookingUrl),
      emptyToNull(body.mapUrl),

      numberOrNull(body.lat),
      numberOrNull(body.lng),

      numberOrNull(body.rating),
      numberOrNull(body.ratingMax),
      numberOrNull(body.reviewCount),

      numberOrNull(body.totalPrice),

      numberOrNull(body.bedrooms),
      emptyToNull(body.bedDescription),

      boolOrNull(body.hasKitchen),
      boolOrNull(body.hasLivingRoom),
      boolOrNull(body.hasElevator),

      emptyToNull(body.cancelPolicy),
      emptyToNull(body.note),

      emptyToNull(body.image)
    ).run();

    return Response.json({
      ok: true,
      id: result.meta?.last_row_id ?? null
    });

  } catch (err) {
    return Response.json(
      {
        ok: false,
        message: err.message
      },
      {
        status: 500
      }
    );
  }
}
// -------------------------
// 修改地點
// -------------------------
if (
  url.pathname.startsWith("/api/admin/places/") &&
  request.method === "PUT"
) {
  try {
    const id = Number(url.pathname.split("/").pop());

    if (!Number.isInteger(id) || id <= 0) {
      return Response.json(
        { ok: false, message: "無效的 id" },
        { status: 400 }
      );
    }

    const body = await request.json();

    if (!body.name || !String(body.name).trim()) {
      return Response.json(
        { ok: false, message: "名稱不能空白" },
        { status: 400 }
      );
    }

    const emptyToNull = value => {
      if (value === undefined || value === null || value === "") {
        return null;
      }
      return value;
    };

    const numberOrNull = value => {
      if (value === undefined || value === null || value === "") {
        return null;
      }

      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const boolOrNull = value => {
      if (value === undefined || value === null || value === "") {
        return null;
      }

      return value ? 1 : 0;
    };

    const result = await env.DB.prepare(`
      UPDATE places
      SET
        type = ?,
        name = ?,
        area = ?,
        platform = ?,
        url = ?,
        map_url = ?,
        lat = ?,
        lng = ?,
        rating = ?,
        rating_max = ?,
        review_count = ?,
        total_price = ?,
        bedrooms = ?,
        bed_description = ?,
        has_kitchen = ?,
        has_living_room = ?,
        has_elevator = ?,
        cancel_policy = ?,
        note = ?,
        image_url = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      body.type || "hotel",
      String(body.name).trim(),
      emptyToNull(body.area),
      emptyToNull(body.platform),
      emptyToNull(body.bookingUrl),
      emptyToNull(body.mapUrl),
      numberOrNull(body.lat),
      numberOrNull(body.lng),
      numberOrNull(body.rating),
      numberOrNull(body.ratingMax),
      numberOrNull(body.reviewCount),
      numberOrNull(body.totalPrice),
      numberOrNull(body.bedrooms),
      emptyToNull(body.bedDescription),
      boolOrNull(body.hasKitchen),
      boolOrNull(body.hasLivingRoom),
      boolOrNull(body.hasElevator),
      emptyToNull(body.cancelPolicy),
      emptyToNull(body.note),
      emptyToNull(body.image),
      id
    ).run();

    return Response.json({
      ok: true,
      changes: result.meta?.changes ?? 0
    });

  } catch (err) {
    return Response.json(
      { ok: false, message: err.message },
      { status: 500 }
    );
  }
}

// -------------------------
// 刪除地點
// -------------------------
if (
  url.pathname.startsWith("/api/admin/places/") &&
  request.method === "DELETE"
) {
  try {
    const id = Number(url.pathname.split("/").pop());

    if (!Number.isInteger(id) || id <= 0) {
      return Response.json(
        { ok: false, message: "無效的 id" },
        { status: 400 }
      );
    }

    const result = await env.DB
      .prepare("DELETE FROM places WHERE id = ?")
      .bind(id)
      .run();

    return Response.json({
      ok: true,
      changes: result.meta?.changes ?? 0
    });

  } catch (err) {
    return Response.json(
      { ok: false, message: err.message },
      { status: 500 }
    );
  }
}

// -------------------------
// 解析 Google Maps 網址座標
// 對照原本 server.py 的 resolve_google_maps_url()
// -------------------------
if (
  url.pathname === "/api/admin/resolve-map" &&
  request.method === "GET"
) {
  try {
    const mapUrl = (url.searchParams.get("url") || "").trim();

    if (!mapUrl) {
      throw new Error("缺少 Google Maps 網址");
    }

    // -------------------------
    // 對照 Python _valid_point()
    // -------------------------
    function validPoint(lat, lng) {
      return (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
      );
    }

    // -------------------------
    // 對照 Python extract_coordinates()
    // -------------------------
    function extractCoordinates(text) {
      if (!text) return null;

      let decoded = String(text);

      try {
        decoded = decodeURIComponent(decoded);
      } catch {}

      // 1. !3dLAT!4dLNG
      let match = decoded.match(
        /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/
      );

      if (match) {
        const lat = Number(match[1]);
        const lng = Number(match[2]);

        if (validPoint(lat, lng)) {
          return {
            lat,
            lng,
            source: "place"
          };
        }
      }

      // 2. query / q / ll / center
      try {
        const parsed = new URL(decoded);

        for (const key of ["query", "q", "ll", "center"]) {
          const values = parsed.searchParams.getAll(key);

          for (const value of values) {
            const pair = value.match(
              /(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/
            );

            if (pair) {
              const lat = Number(pair[1]);
              const lng = Number(pair[2]);

              if (validPoint(lat, lng)) {
                return {
                  lat,
                  lng,
                  source: "query"
                };
              }
            }
          }
        }
      } catch {}

      // 3. @LAT,LNG
      match = decoded.match(
        /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/
      );

      if (match) {
        const lat = Number(match[1]);
        const lng = Number(match[2]);

        if (validPoint(lat, lng)) {
          return {
            lat,
            lng,
            source: "viewport"
          };
        }
      }

      return null;
    }
    function extractPlusCode(text) {
  if (!text) return null;

  let value = String(text);

  // Google 的 continue URL 可能被 encode 好幾層
  for (let i = 0; i < 4; i++) {
    try {
      const decoded = decodeURIComponent(value);

      if (decoded === value) break;

      value = decoded;
    } catch {
      break;
    }
  }

  const match = value.match(
    /([23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2,7})/i
  );

  return match ? match[1].toUpperCase() : null;
}


function decodePlusCode(code) {
  const alphabet = "23456789CFGHJMPQRVWX";

  code = String(code)
    .toUpperCase()
    .replace("+", "")
    .replace(/0/g, "");

  if (code.length < 10) {
    return null;
  }

  let lat = -90;
  let lng = -180;

  let resolution = 20;

  // 前 10 碼：lat/lng 交錯 base-20
  for (let i = 0; i < 10; i += 2) {
    const latDigit = alphabet.indexOf(code[i]);
    const lngDigit = alphabet.indexOf(code[i + 1]);

    if (latDigit < 0 || lngDigit < 0) {
      return null;
    }

    lat += latDigit * resolution;
    lng += lngDigit * resolution;

    resolution /= 20;
  }

  let latResolution = 0.000125;
  let lngResolution = 0.000125;

  // 第 11 碼之後是 5 x 4 grid
  for (let i = 10; i < code.length; i++) {
    const digit = alphabet.indexOf(code[i]);

    if (digit < 0) {
      return null;
    }

    latResolution /= 5;
    lngResolution /= 4;

    const row = Math.floor(digit / 4);
    const col = digit % 4;

    lat += row * latResolution;
    lng += col * lngResolution;
  }

  // 使用區域中心點
  lat += latResolution / 2;
  lng += lngResolution / 2;

  if (
    lat < -90 || lat > 90 ||
    lng < -180 || lng > 180
  ) {
    return null;
  }

  return {
    lat,
    lng,
    source: "plus-code"
  };
}

    // -------------------------
    // 對照 Python 網域檢查
    // -------------------------
    let parsedUrl;

    try {
      parsedUrl = new URL(mapUrl);
    } catch {
      throw new Error("地圖網址格式不正確");
    }

    if (
      parsedUrl.protocol !== "http:" &&
      parsedUrl.protocol !== "https:"
    ) {
      throw new Error("地圖網址必須是 http/https 網址");
    }

    const host = parsedUrl.hostname.toLowerCase();

    const allowed =
      host === "maps.app.goo.gl" ||
      host === "goo.gl" ||
      host === "google.com" ||
      host === "maps.google.com" ||
      host.endsWith(".google.com") ||
      host.endsWith(".google.co.kr") ||
      host.endsWith(".google.com.tw");

    if (!allowed) {
      throw new Error("目前只支援 Google Maps 網址");
    }

    // -------------------------
    // 跟 Python 一樣：
    // 原始網址自己已經有座標就直接回傳
    // -------------------------
    const direct = extractCoordinates(mapUrl);

    if (direct) {
      return Response.json({
        ok: true,
        ...direct,
        finalUrl: mapUrl
      });
    }

    // -------------------------
    // 對照 urllib.request.urlopen()
    //
    // 關鍵：
    // 不再自己 manual redirect
    // 讓 Cloudflare 自己 follow 到最後
    // -------------------------
    const response = await fetch(mapUrl, {
      method: "GET",

      redirect: "follow",

      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 Chrome/124 Safari/537.36"
      }
    });

    // 對照 response.geturl()
    const finalUrl = response.url || mapUrl;

    // 對照 Python response.read(768 * 1024)
    const buffer = await response.arrayBuffer();

    const maxLength = Math.min(
      buffer.byteLength,
      768 * 1024
    );

    const firstPart = buffer.slice(0, maxLength);

    const body = new TextDecoder(
      "utf-8",
      { fatal: false }
    ).decode(firstPart);

    // -------------------------
    // Python 原本就是這個順序：
    //
    // extract(final_url)
    // OR
    // extract(body)
    // -------------------------
    let point =
  extractCoordinates(finalUrl) ||
  extractCoordinates(body);

// Cloudflare 被 Google 導向 /sorry 時，
// 嘗試從 continue URL / HTML 中取得 Plus Code。
if (!point) {
  let plusCode =
    extractPlusCode(finalUrl) ||
    extractPlusCode(body);

  if (plusCode) {
    point = decodePlusCode(plusCode);
  }
}

    if (!point) {
      // 這次留下診斷資訊。
      // 如果 Cloudflare 收到的 Google 回應跟本機不同，
      // 我們可以直接看出來，不再猜。
      return Response.json(
        {
          ok: false,

          message:
            "Google Maps 網址已開啟，但沒有找到可用座標。",

          debug: {
            status: response.status,
            redirected: response.redirected,
            finalUrl,
            contentType:
              response.headers.get("content-type"),
            bodyBytes: buffer.byteLength
          }
        },
        {
          status: 400
        }
      );
    }

    return Response.json({
      ok: true,
      lat: point.lat,
      lng: point.lng,
      source: point.source,
      finalUrl
    });

  } catch (err) {
    return Response.json(
      {
        ok: false,
        message: err.message
      },
      {
        status: 400
      }
    );
  }
}


    // -------------------------
    // 取得可投票的朋友名單
    // -------------------------
    if (
      url.pathname === "/api/voters" &&
      request.method === "GET"
    ) {
      try {
        const result = await env.DB.prepare(`
          SELECT id, name
          FROM voters
          WHERE is_active = 1
          ORDER BY id ASC
        `).all();

        return Response.json({
          ok: true,
          data: result.results
        });
      } catch (err) {
        return Response.json(
          {
            ok: false,
            message: err.message
          },
          {
            status: 500
          }
        );
      }
    }

    // -------------------------
    // 選擇目前投票身分
    // -------------------------
    if (
      url.pathname === "/api/voter/select" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();
        const voterId = Number(body.voterId);

        if (!Number.isInteger(voterId) || voterId <= 0) {
          return Response.json(
            {
              ok: false,
              message: "請選擇有效的名字"
            },
            {
              status: 400
            }
          );
        }

        const voter = await env.DB.prepare(`
          SELECT id, name
          FROM voters
          WHERE id = ?
            AND is_active = 1
        `)
          .bind(voterId)
          .first();

        if (!voter) {
          return Response.json(
            {
              ok: false,
              message: "找不到這個投票成員"
            },
            {
              status: 404
            }
          );
        }

        const token = await createVoterSession(
          voter.id,
          env
        );

        return Response.json(
          {
            ok: true,
            voter
          },
          {
            headers: {
              "Set-Cookie":
                `voter_session=${token}; ` +
                `Path=/; ` +
                `HttpOnly; ` +
                `Secure; ` +
                `SameSite=Lax; ` +
                `Max-Age=15552000`
            }
          }
        );
      } catch (err) {
        return Response.json(
          {
            ok: false,
            message: err.message
          },
          {
            status: 500
          }
        );
      }
    }

    // -------------------------
    // 查看目前投票身分
    // -------------------------
    if (
      url.pathname === "/api/voter/me" &&
      request.method === "GET"
    ) {
      try {
        const voter = await getCurrentVoter(
          request,
          env
        );

        return Response.json({
          ok: true,
          voter
        });
      } catch (err) {
        return Response.json(
          {
            ok: false,
            message: err.message
          },
          {
            status: 500
          }
        );
      }
    }

    // -------------------------
    // 測試 D1
    // -------------------------
    if (url.pathname === "/api/test") {
      const row = await env.DB
        .prepare("SELECT COUNT(*) AS count FROM places")
        .first();

      return Response.json({
        ok: true,
        places: row.count
      });
    }

    // -------------------------
    // 公開讀取地點資料
    // -------------------------
    if (
      url.pathname === "/api/places" &&
      request.method === "GET"
    ) {
      const type = url.searchParams.get("type");

      let query = `
        SELECT *
        FROM places
      `;

      const params = [];

      if (type) {
        query += ` WHERE type = ?`;
        params.push(type);
      }

      query += ` ORDER BY id ASC`;

      const stmt = env.DB.prepare(query);

      const result = params.length
        ? await stmt.bind(...params).all()
        : await stmt.all();

      const data = result.results.map(row => ({
        id: row.id,
        type: row.type,

        name: row.name,
        area: row.area,
        platform: row.platform,

        bookingUrl: row.url,
        mapUrl: row.map_url,

        lat: row.lat,
        lng: row.lng,

        rating: row.rating,
        ratingMax: row.rating_max,
        reviewCount: row.review_count,

        totalPrice: row.total_price,

        bedrooms: row.bedrooms,
        bedDescription: row.bed_description,

        hasKitchen:
          row.has_kitchen == null
            ? null
            : Boolean(row.has_kitchen),

        hasLivingRoom:
          row.has_living_room == null
            ? null
            : Boolean(row.has_living_room),

        hasElevator:
          row.has_elevator == null
            ? null
            : Boolean(row.has_elevator),

        cancelPolicy: row.cancel_policy,
        note: row.note,

        image: row.image_url || "",
        images: []
      }));

      return Response.json({
        ok: true,
        data
      });
    }

    // 其他檔案照常提供
    return env.ASSETS.fetch(request);
  }
};
