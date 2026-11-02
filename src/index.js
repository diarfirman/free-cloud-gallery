function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Pure WebCrypto AWS SigV4 Presigned URL generator untuk R2 Direct Upload
async function generateR2PresignedUrl({ method = "PUT", accountId, accessKeyId, secretAccessKey, bucketName, objectKey, expiresIn = 900, responseContentDisposition = null }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const endpoint = `https://${host}/${bucketName}/${objectKey}`;

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host"
  });

  if (responseContentDisposition) {
    queryParams.set("response-content-disposition", responseContentDisposition);
  }

  queryParams.sort();
  const canonicalQueryString = queryParams.toString().replace(/\+/g, "%20");

  const canonicalRequest = [
    method,
    `/${bucketName}/${objectKey}`,
    canonicalQueryString,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD"
  ].join("\n");

  const sha256 = async (str) => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  };

  const hmacSha256 = async (key, data) => {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      typeof key === "string" ? new TextEncoder().encode(key) : key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    return await crypto.subtle.sign("HMAC", cryptoKey, typeof data === "string" ? new TextEncoder().encode(data) : data);
  };

  const canonicalRequestHash = await sha256(canonicalRequest);

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    canonicalRequestHash
  ].join("\n");

  const kDate = await hmacSha256("AWS4" + secretAccessKey, dateStamp);
  const kRegion = await hmacSha256(kDate, "auto");
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signatureBytes = await hmacSha256(kSigning, stringToSign);
  const signature = Array.from(new Uint8Array(signatureBytes)).map(b => b.toString(16).padStart(2, "0")).join("");

  return `${endpoint}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

// Helper validasi role (admin vs viewer)
function getAuthRole(request, env) {
  const clientKey = request.headers.get("X-API-KEY");
  if (!clientKey) return null;

  // 1. Kunci Admin (Upload & Hapus & Lihat)
  if (env.UPLOAD_SECRET && clientKey === env.UPLOAD_SECRET) {
    return "admin";
  }

  // 2. Kunci Tamu (Hanya Lihat / Read-only)
  const viewSecret = env.VIEW_SECRET || env.UPLOAD_SECRET;
  if (clientKey === viewSecret) {
    return "viewer";
  }

  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Header CORS Komprehensif
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-KEY",
      "Access-Control-Max-Age": "86400",
    };

    // 1. Handle Preflight Request
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      // 2. Endpoint POST: Verify access key and return role
      if (request.method === "POST" && url.pathname === "/api/verify") {
        const role = getAuthRole(request, env);
        if (!role) {
          return Response.json(
            { valid: false, error: "Invalid access key!" },
            { status: 401, headers: corsHeaders }
          );
        }
        return Response.json({ valid: true, role }, { headers: corsHeaders });
      }

      // 3. Endpoint GET: Retrieve R2 storage utilization
      if (request.method === "GET" && url.pathname === "/api/storage") {
        const role = getAuthRole(request, env);
        if (!role) {
          return Response.json({ error: "Access Denied: Invalid access key!" }, { status: 401, headers: corsHeaders });
        }

        const row = await env.DB.prepare(
          "SELECT COUNT(*) AS total_photos, COALESCE(SUM(size_bytes), 0) AS total_bytes FROM photos"
        ).first();

        const totalBytes = row ? (row.total_bytes || 0) : 0;
        const totalPhotos = row ? (row.total_photos || 0) : 0;
        const limitBytes = 10 * 1024 * 1024 * 1024; // 10 GB Free Tier R2
        const percent = Math.min(100, Math.round((totalBytes / limitBytes) * 10000) / 100);
        const remainingBytes = Math.max(0, limitBytes - totalBytes);

        return Response.json({
          used_bytes: totalBytes,
          used_formatted: formatBytes(totalBytes),
          limit_bytes: limitBytes,
          limit_formatted: "10 GB",
          percentage: percent,
          remaining_bytes: remainingBytes,
          remaining_formatted: formatBytes(remainingBytes),
          total_photos: totalPhotos,
          role
        }, { headers: corsHeaders });
      }

      // 4. Endpoint GET: Retrieve album list
      if (request.method === "GET" && url.pathname === "/api/albums") {
        const role = getAuthRole(request, env);
        if (!role) {
          return Response.json({ error: "Access Denied: Invalid access key!" }, { status: 401, headers: corsHeaders });
        }

        const { results } = await env.DB.prepare(
          "SELECT name as album FROM albums UNION SELECT DISTINCT album FROM photos WHERE album IS NOT NULL AND album != '' ORDER BY CASE WHEN album = 'General' THEN 0 WHEN album = 'Umum' THEN 1 ELSE 2 END, album ASC"
        ).all().catch(async () => {
          return await env.DB.prepare(
            "SELECT DISTINCT album FROM photos WHERE album IS NOT NULL AND album != '' ORDER BY CASE WHEN album = 'General' THEN 0 WHEN album = 'Umum' THEN 1 ELSE 2 END, album ASC"
          ).all();
        });

        const albums = (results || []).map(r => r.album).filter(Boolean);
        return Response.json(albums, { headers: corsHeaders });
      }

      // 4a. Endpoint POST: Create new album (Admin only)
      if (request.method === "POST" && url.pathname === "/api/albums") {
        const role = getAuthRole(request, env);
        if (role !== "admin") {
          return Response.json({ error: "Access Denied: Admin role required to create albums!" }, { status: 403, headers: corsHeaders });
        }

        const body = await request.json().catch(() => ({}));
        const albumName = (body.name || "").trim();
        if (!albumName) {
          return Response.json({ error: "Album name cannot be empty" }, { status: 400, headers: corsHeaders });
        }

        await env.DB.prepare("INSERT OR IGNORE INTO albums (name) VALUES (?)").bind(albumName).run();
        return Response.json({ success: true, album: albumName }, { headers: corsHeaders });
      }

      // 4b. Endpoint DELETE: Delete album and all media inside it (Admin only)
      if (request.method === "DELETE" && url.pathname.startsWith("/api/albums/")) {
        const role = getAuthRole(request, env);
        if (role !== "admin") {
          return Response.json(
            { error: "Access Denied: Admin role required to delete albums!" },
            { status: 403, headers: corsHeaders }
          );
        }

        const rawName = url.pathname.replace("/api/albums/", "").trim();
        const albumName = decodeURIComponent(rawName);

        if (!albumName || albumName === "General" || albumName === "Umum" || albumName === "all") {
          return Response.json(
            { error: "System albums ('General' or 'All') cannot be deleted!" },
            { status: 400, headers: corsHeaders }
          );
        }

        // Helper extract key R2
        const extractKey = (fileUrl) => {
          if (!fileUrl) return null;
          const apiPrefix = "/api/file/";
          const idx = fileUrl.indexOf(apiPrefix);
          if (idx !== -1) return fileUrl.substring(idx + apiPrefix.length);
          try {
            const parsed = new URL(fileUrl);
            return parsed.pathname.replace(/^\//, "");
          } catch (e) {
            return null;
          }
        };

        // 1. Find all media in this album
        const { results: photos } = await env.DB.prepare(
          "SELECT id, original_url, thumb_url FROM photos WHERE album = ?"
        ).bind(albumName).all();

        let deletedMediaCount = 0;
        if (photos && photos.length > 0) {
          const keysToDelete = [];
          photos.forEach(photo => {
            const photoKey = extractKey(photo.original_url);
            const thumbKey = extractKey(photo.thumb_url);
            if (photoKey) keysToDelete.push(photoKey);
            if (thumbKey && thumbKey !== photoKey) keysToDelete.push(thumbKey);
          });

          // Delete all associated R2 files
          if (keysToDelete.length > 0) {
            await env.PHOTOS_BUCKET.delete(keysToDelete);
          }

          // Delete D1 records
          await env.DB.prepare("DELETE FROM photos WHERE album = ?").bind(albumName).run();
          deletedMediaCount = photos.length;
        }

        // Delete album name from albums table
        await env.DB.prepare("DELETE FROM albums WHERE name = ?").bind(albumName).run().catch(() => {});

        return Response.json({
          success: true,
          message: `Album '${albumName}' and ${deletedMediaCount} media items were deleted successfully.`,
          deleted_count: deletedMediaCount,
          album: albumName
        }, { headers: corsHeaders });
      }

      // 4c. Endpoint PATCH: Rename album and move all media items (Admin only)
      if (request.method === "PATCH" && url.pathname.startsWith("/api/albums/")) {
        const role = getAuthRole(request, env);
        if (role !== "admin") {
          return Response.json(
            { error: "Access Denied: Admin role required to rename albums!" },
            { status: 403, headers: corsHeaders }
          );
        }

        const rawName = url.pathname.replace("/api/albums/", "").trim();
        const oldName = decodeURIComponent(rawName);

        if (!oldName || oldName === "General" || oldName === "Umum" || oldName === "all") {
          return Response.json(
            { error: "System albums ('General' or 'All') cannot be renamed!" },
            { status: 400, headers: corsHeaders }
          );
        }

        const body = await request.json().catch(() => ({}));
        const newName = (body.new_name || "").trim();

        if (!newName || newName === "General" || newName === "Umum" || newName === "all") {
          return Response.json(
            { error: "Invalid new album name!" },
            { status: 400, headers: corsHeaders }
          );
        }

        if (oldName === newName) {
          return Response.json({ success: true, message: "Album name is unchanged." }, { headers: corsHeaders });
        }

        // 1. Insert new name into albums table
        await env.DB.prepare("INSERT OR IGNORE INTO albums (name) VALUES (?)").bind(newName).run();

        // 2. Update photos to new album name
        const updateRes = await env.DB.prepare(
          "UPDATE photos SET album = ? WHERE album = ?"
        ).bind(newName, oldName).run();

        // 3. Remove old name from albums table
        await env.DB.prepare("DELETE FROM albums WHERE name = ?").bind(oldName).run();

        return Response.json({
          success: true,
          message: `Album '${oldName}' successfully renamed to '${newName}'.`,
          old_name: oldName,
          new_name: newName,
          updated_photos: updateRes.meta ? updateRes.meta.changes : 0
        }, { headers: corsHeaders });
      }

      // 5. Endpoint GET: Retrieve photo list (with pagination, album filter & sorting)
      if (request.method === "GET" && url.pathname === "/api/photos") {
        const role = getAuthRole(request, env);
        if (!role) {
          return Response.json({ error: "Access Denied: Invalid access key!" }, { status: 401, headers: corsHeaders });
        }

        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1), 100);
        const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);
        const album = url.searchParams.get("album");
        const sort = url.searchParams.get("sort") || "newest";

        // Sorting mapping: date / title / size
        let orderByClause = "created_at DESC";
        if (sort === "oldest") {
          orderByClause = "created_at ASC";
        } else if (sort === "title_asc") {
          orderByClause = "title ASC, created_at DESC";
        } else if (sort === "title_desc") {
          orderByClause = "title DESC, created_at DESC";
        } else if (sort === "size_desc") {
          orderByClause = "size_bytes DESC, created_at DESC";
        }

        let query = "SELECT * FROM photos";
        const params = [];

        if (album && album !== "all") {
          query += " WHERE album = ?";
          params.push(album);
        }

        query += ` ORDER BY ${orderByClause} LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const { results } = await env.DB.prepare(query).bind(...params).all();

        return Response.json(results || [], {
          headers: corsHeaders
        });
      }

      // 6. Endpoint PATCH: Edit title or album (Admin only)
      if (request.method === "PATCH" && url.pathname.startsWith("/api/photos/")) {
        const role = getAuthRole(request, env);
        if (role !== "admin") {
          return Response.json(
            { error: "Access Denied: Admin role required to edit media!" },
            { status: 403, headers: corsHeaders }
          );
        }

        const id = url.pathname.replace("/api/photos/", "").trim();
        const body = await request.json().catch(() => ({}));
        const { title, album, created_at } = body;

        const photo = await env.DB.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first();
        if (!photo) {
          return Response.json({ error: "Media item not found" }, { status: 404, headers: corsHeaders });
        }

        const updatedTitle = title !== undefined ? String(title).trim() : photo.title;
        const updatedAlbum = album !== undefined ? (String(album).trim() || "General") : photo.album;
        const updatedCreatedAt = (created_at && /^\d{4}-\d{2}-\d{2}/.test(created_at)) ? created_at : photo.created_at;

        await env.DB.prepare(
          "UPDATE photos SET title = ?, album = ?, created_at = ? WHERE id = ?"
        ).bind(updatedTitle, updatedAlbum, updatedCreatedAt, id).run();

        // Ensure album is recorded in albums table
        await env.DB.prepare("INSERT OR IGNORE INTO albums (name) VALUES (?)").bind(updatedAlbum).run().catch(() => {});

        return Response.json({
          success: true,
          message: "Media information updated successfully",
          photo: { id, title: updatedTitle, album: updatedAlbum, created_at: updatedCreatedAt }
        }, { headers: corsHeaders });
      }

      // 7. Endpoint GET: Generate Presigned Download URL (Direct-to-Disk Download, zero RAM OOM)
      // Format: /api/photos/:id/download-url
      const downloadMatch = url.pathname.match(/^\/api\/photos\/([a-zA-Z0-9_-]+)\/download-url$/);
      if (request.method === "GET" && downloadMatch) {
        const role = getAuthRole(request, env);
        if (!role) {
          return Response.json({ error: "Access Denied: Invalid access key!" }, { status: 401, headers: corsHeaders });
        }

        const photoId = downloadMatch[1];
        const photo = await env.DB.prepare(
          "SELECT id, filename, original_url, media_type FROM photos WHERE id = ?"
        ).bind(photoId).first();

        if (!photo) {
          return Response.json({ error: "Media item not found" }, { status: 404, headers: corsHeaders });
        }

        const origUrlObj = new URL(photo.original_url);
        const objectKey = origUrlObj.pathname.replace(/^\/+/, "");

        const accountId = env.R2_ACCOUNT_ID;
        const accessKeyId = env.R2_ACCESS_KEY_ID;
        const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
        const bucketName = env.R2_BUCKET_NAME || "gallery-photos";

        if (!accountId || !accessKeyId || !secretAccessKey) {
          return Response.json(
            { error: "R2 S3 credentials not configured in Worker environment!" },
            { status: 500, headers: corsHeaders }
          );
        }

        const safeFilename = (photo.filename || (photo.media_type === "video" ? "download_video.mp4" : "download_photo.jpg")).replace(/[^\w.-]/g, "_");

        const presignedDownloadUrl = await generateR2PresignedUrl({
          method: "GET",
          accountId,
          accessKeyId,
          secretAccessKey,
          bucketName,
          objectKey,
          expiresIn: 300,
          responseContentDisposition: `attachment; filename="${safeFilename}"`
        });

        return Response.json({
          success: true,
          download_url: presignedDownloadUrl,
          filename: safeFilename
        }, { headers: corsHeaders });
      }

      // 8. Endpoint POST: Request Presigned URL for Direct-to-R2 Upload (Zero CPU load on Worker!)
      if (request.method === "POST" && url.pathname === "/api/upload/direct-url") {
        const role = getAuthRole(request, env);
        if (role !== "admin") {
          return Response.json({ error: "Access Denied: Admin role required to upload media!" }, { status: 403, headers: corsHeaders });
        }

        const body = await request.json().catch(() => ({}));
        const { filename, type } = body;
        if (!filename) {
          return Response.json({ error: "Invalid filename" }, { status: 400, headers: corsHeaders });
        }

        const isVideo = (type && type.startsWith("video/")) || /\.(mp4|mov|webm|m4v)$/i.test(filename);
        const id = crypto.randomUUID();
        const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const photoKey = isVideo ? `videos/${id}-${sanitized}` : `photos/${id}-${sanitized}`;
        const thumbKey = `thumbs/${id}-${sanitized}.webp`;

        const accountId = env.R2_ACCOUNT_ID;
        const accessKeyId = env.R2_ACCESS_KEY_ID;
        const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
        const bucketName = env.R2_BUCKET_NAME || "gallery-photos";

        if (!accountId || !accessKeyId || !secretAccessKey) {
          return Response.json(
            { error: "R2 S3 credentials not configured in Worker environment!" },
            { status: 500, headers: corsHeaders }
          );
        }

        const uploadUrl = await generateR2PresignedUrl({
          accountId,
          accessKeyId,
          secretAccessKey,
          bucketName,
          objectKey: photoKey
        });

        const thumbUploadUrl = await generateR2PresignedUrl({
          accountId,
          accessKeyId,
          secretAccessKey,
          bucketName,
          objectKey: thumbKey
        });

        return Response.json({
          id,
          upload_url: uploadUrl,
          thumb_upload_url: thumbUploadUrl,
          photo_key: photoKey,
          thumb_key: thumbKey,
          is_video: isVideo
        }, { headers: corsHeaders });
      }

      // 8. Endpoint POST: Confirm Direct Upload completion (Save metadata to D1)
      if (request.method === "POST" && url.pathname === "/api/upload/complete") {
        const role = getAuthRole(request, env);
        if (role !== "admin") {
          return Response.json({ error: "Access Denied: Admin role required to complete upload!" }, { status: 403, headers: corsHeaders });
        }

        const body = await request.json().catch(() => ({}));
        const { id, filename, photo_key, thumb_key, title, album, size_bytes, media_type, date_modified, has_thumb } = body;

        const mediaBase = env.MEDIA_BASE_URL 
          ? env.MEDIA_BASE_URL.replace(/\/$/, "") 
          : `${url.origin}/api/file`;

        const originalUrl = `${mediaBase}/${photo_key}`;
        const thumbUrl = has_thumb ? `${mediaBase}/${thumb_key}` : originalUrl;
        const finalTitle = title || filename || "Untitled";
        const finalAlbum = album || "General";
        const finalSize = size_bytes || 0;
        const finalType = media_type || "image";

        let dateToSave = null;
        if (date_modified && /^\d{4}-\d{2}-\d{2}/.test(date_modified)) {
          dateToSave = date_modified;
        }

        if (dateToSave) {
          await env.DB.prepare(
            "INSERT INTO photos (id, filename, original_url, thumb_url, title, album, size_bytes, media_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
          ).bind(id, filename, originalUrl, thumbUrl, finalTitle, finalAlbum, finalSize, finalType, dateToSave).run();
        } else {
          await env.DB.prepare(
            "INSERT INTO photos (id, filename, original_url, thumb_url, title, album, size_bytes, media_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ).bind(id, filename, originalUrl, thumbUrl, finalTitle, finalAlbum, finalSize, finalType).run();
        }

        // Ensure album is recorded in albums table
        await env.DB.prepare("INSERT OR IGNORE INTO albums (name) VALUES (?)").bind(finalAlbum).run().catch(() => {});

        return Response.json({ success: true, id }, { headers: corsHeaders });
      }

      // 9. Endpoint POST: Upload photo & thumbnail (Worker Fallback)
      if (request.method === "POST" && url.pathname === "/api/upload") {
        const role = getAuthRole(request, env);
        if (role !== "admin") {
          return Response.json(
            { error: "Access Denied: Admin role required to upload media!" },
            { status: 403, headers: corsHeaders }
          );
        }

        const formData = await request.formData();
        const file = formData.get("file");
        const thumb = formData.get("thumb");
        const title = formData.get("title") || (file && file.name) || "Untitled";
        const album = (formData.get("album") || "General").trim();
        const dateModified = formData.get("date_modified");

        if (!file || typeof file === "string") {
          return Response.json({ error: "File not found" }, { status: 400, headers: corsHeaders });
        }

        const isVideo = (file.type && file.type.startsWith("video/")) || /\.(mp4|mov|webm|m4v)$/i.test(file.name);
        const isImage = (file.type && file.type.startsWith("image/")) || /\.(jpg|jpeg|png|webp|heic|avif|gif)$/i.test(file.name);

        if (!isImage && !isVideo) {
          return Response.json({ error: "Only image or video files are allowed!" }, { status: 400, headers: corsHeaders });
        }

        const maxLimit = isVideo ? 85 * 1024 * 1024 : 15 * 1024 * 1024;
        if (file.size > maxLimit) {
          const limitMb = isVideo ? "85MB" : "15MB";
          return Response.json({ error: `File size exceeds ${limitMb} limit for Free Tier.` }, { status: 400, headers: corsHeaders });
        }

        const mediaType = isVideo ? "video" : "image";
        const id = crypto.randomUUID();
        const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const photoKey = isVideo ? `videos/${id}-${sanitizedName}` : `photos/${id}-${sanitizedName}`;
        const thumbKey = `thumbs/${id}-${sanitizedName}.webp`;

        const mediaBase = env.MEDIA_BASE_URL 
          ? env.MEDIA_BASE_URL.replace(/\/$/, "") 
          : `${url.origin}/api/file`;

        await env.PHOTOS_BUCKET.put(photoKey, file.stream(), {
          httpMetadata: { contentType: file.type || (isVideo ? "video/mp4" : "image/jpeg") }
        });

        let thumbUrl = null;
        if (thumb && typeof thumb !== "string") {
          await env.PHOTOS_BUCKET.put(thumbKey, thumb.stream(), {
            httpMetadata: { contentType: thumb.type || "image/webp" }
          });
          thumbUrl = `${mediaBase}/${thumbKey}`;
        }

        const originalUrl = `${mediaBase}/${photoKey}`;
        if (!thumbUrl) thumbUrl = originalUrl;

        const sizeBytes = (file.size || 0) + (thumb && typeof thumb !== "string" ? (thumb.size || 0) : 0);

        let dateToSave = null;
        if (dateModified && /^\d{4}-\d{2}-\d{2}/.test(dateModified)) {
          dateToSave = dateModified;
        }

        if (dateToSave) {
          await env.DB.prepare(
            "INSERT INTO photos (id, filename, original_url, thumb_url, title, album, size_bytes, media_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
          ).bind(id, file.name, originalUrl, thumbUrl, title, album, sizeBytes, mediaType, dateToSave).run();
        } else {
          await env.DB.prepare(
            "INSERT INTO photos (id, filename, original_url, thumb_url, title, album, size_bytes, media_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ).bind(id, file.name, originalUrl, thumbUrl, title, album, sizeBytes, mediaType).run();
        }

        await env.DB.prepare("INSERT OR IGNORE INTO albums (name) VALUES (?)").bind(album).run().catch(() => {});

        return Response.json({ success: true, id, media_type: mediaType }, { headers: corsHeaders });
      }

      // 10. Endpoint POST: Batch delete media from R2 and D1 (Admin only)
      if (request.method === "POST" && url.pathname === "/api/photos/batch-delete") {
        const role = getAuthRole(request, env);
        if (role !== "admin") {
          return Response.json(
            { error: "Access Denied: Admin role required to delete media!" },
            { status: 403, headers: corsHeaders }
          );
        }

        const body = await request.json().catch(() => ({}));
        const { ids } = body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
          return Response.json({ error: "Invalid list of IDs" }, { status: 400, headers: corsHeaders });
        }

        const extractKey = (fileUrl) => {
          if (!fileUrl) return null;
          const apiPrefix = "/api/file/";
          const idx = fileUrl.indexOf(apiPrefix);
          if (idx !== -1) return fileUrl.substring(idx + apiPrefix.length);
          try {
            const parsed = new URL(fileUrl);
            return parsed.pathname.replace(/^\//, "");
          } catch (e) {
            return null;
          }
        };

        const placeholders = ids.map(() => "?").join(",");
        const { results: photos } = await env.DB.prepare(
          `SELECT id, original_url, thumb_url FROM photos WHERE id IN (${placeholders})`
        ).bind(...ids).all();

        if (photos && photos.length > 0) {
          const keysToDelete = [];
          photos.forEach(photo => {
            const photoKey = extractKey(photo.original_url);
            const thumbKey = extractKey(photo.thumb_url);
            if (photoKey) keysToDelete.push(photoKey);
            if (thumbKey && thumbKey !== photoKey) keysToDelete.push(thumbKey);
          });

          if (keysToDelete.length > 0) {
            await env.PHOTOS_BUCKET.delete(keysToDelete);
          }

          await env.DB.prepare(
            `DELETE FROM photos WHERE id IN (${placeholders})`
          ).bind(...ids).run();
        }

        return Response.json({
          success: true,
          message: `${photos ? photos.length : 0} items successfully deleted`,
          deleted_count: photos ? photos.length : 0
        }, { headers: corsHeaders });
      }

      // 11. Endpoint DELETE: Delete single media item from R2 and D1 (Admin only)
      if (request.method === "DELETE" && url.pathname.startsWith("/api/photos/")) {
        const role = getAuthRole(request, env);
        if (role !== "admin") {
          return Response.json(
            { error: "Access Denied: Admin role required to delete media!" },
            { status: 403, headers: corsHeaders }
          );
        }

        const id = url.pathname.replace("/api/photos/", "").trim();
        if (!id) {
          return Response.json({ error: "Invalid photo ID" }, { status: 400, headers: corsHeaders });
        }

        const photo = await env.DB.prepare(
          "SELECT * FROM photos WHERE id = ?"
        ).bind(id).first();

        if (!photo) {
          return Response.json({ error: "Media item not found" }, { status: 404, headers: corsHeaders });
        }

        const extractKey = (fileUrl) => {
          if (!fileUrl) return null;
          const apiPrefix = "/api/file/";
          const idx = fileUrl.indexOf(apiPrefix);
          if (idx !== -1) return fileUrl.substring(idx + apiPrefix.length);

          try {
            const parsed = new URL(fileUrl);
            return parsed.pathname.replace(/^\//, "");
          } catch (e) {
            return null;
          }
        };

        const photoKey = extractKey(photo.original_url);
        const thumbKey = extractKey(photo.thumb_url);

        if (photoKey) {
          await env.PHOTOS_BUCKET.delete(photoKey);
        }
        if (thumbKey && thumbKey !== photoKey) {
          await env.PHOTOS_BUCKET.delete(thumbKey);
        }

        await env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(id).run();

        return Response.json({ success: true, message: "Media item deleted successfully" }, { headers: corsHeaders });
      }

      // 12. Endpoint GET File: Display/Stream media from R2 (Fallback)
      if (request.method === "GET" && url.pathname.startsWith("/api/file/")) {
        const key = url.pathname.replace("/api/file/", "");
        const object = await env.PHOTOS_BUCKET.get(key);

        if (!object) {
          return new Response("File Not Found", { status: 404, headers: corsHeaders });
        }

        const headers = new Headers(corsHeaders);
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);
        headers.set("Cache-Control", "public, max-age=31536000, immutable");

        return new Response(object.body, { headers });
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });

    } catch (err) {
      return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
    }
  }
};