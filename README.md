# 7A6 Study Bot — V1 VIP PRO

Web app học tập responsive cho điện thoại và máy tính, chạy bằng Node.js + Express.

## Tính năng
- AI Study Bot
- XP, Level, Streak, Badge
- Điểm danh +25 XP
- Nhiệm vụ hằng ngày do Admin tạo
- Lịch học do Admin đăng
- Thông báo do Admin đăng
- Leaderboard
- Admin Control Center
- Rate limit + AI cooldown + giới hạn 30 lượt AI/ngày
- Password hashing bằng scrypt
- API key chỉ nằm ở server, không đưa vào frontend
- Health check `/health` cho Render

## Chạy local
1. Cài Node.js 20+ (khuyến nghị Node 22).
2. `npm install`
3. Sao chép `.env.example` thành `.env`.
4. Điền `OPENAI_API_KEY`, `ADMIN_USER`, `ADMIN_PASSWORD`.
5. `npm start`
6. Mở `http://localhost:3000`

## Deploy lên GitHub + Render
Project đã có sẵn `render.yaml`, `.gitignore` và `.nvmrc`.

### GitHub
Đưa toàn bộ thư mục này lên một repository GitHub. Không commit `.env`, API key hoặc `data/db.json`.

### Render
Có thể deploy bằng Blueprint từ `render.yaml`, hoặc tạo Web Service với:
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

Environment Variables bắt buộc:
- `OPENAI_API_KEY`: API key của OpenAI
- `ADMIN_USER`: tên tài khoản Admin
- `ADMIN_PASSWORD`: mật khẩu Admin, tối thiểu 12 ký tự
- `OPENAI_MODEL`: model AI; có thể giữ giá trị trong `render.yaml` nếu model đó có trong tài khoản của bạn

Sau khi deploy, Render sẽ cấp URL công khai dạng `https://<service-name>.onrender.com`.

## Lưu ý dữ liệu
V1 hiện dùng `data/db.json` để lưu dữ liệu. File này bị `.gitignore` để không đưa dữ liệu người dùng lên GitHub. Trên môi trường cloud không có persistent storage, dữ liệu file có thể mất khi service được thay thế/redeploy. Nếu dùng lâu dài cho nhiều người, nên chuyển dữ liệu sang PostgreSQL hoặc bật persistent disk phù hợp với gói Render.
