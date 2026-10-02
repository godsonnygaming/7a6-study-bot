# 7A6 Study Bot V2

Bản hoàn thiện dùng Express + PostgreSQL + OpenAI, tối ưu cho Render.

## Có gì mới
- UI V2 hiện đại, responsive/mobile.
- Sửa lỗi đăng nhập FormData.
- Check-in được khóa **1 lần/ngày ở database**, chống spam API.
- Task XP cũng khóa theo ngày và transaction/row lock.
- Auth token lưu PostgreSQL.
- Rate limit cho API và AI.
- Admin dashboard.
- AI tối đa 30 lượt/ngày/người + 5 XP/lượt.
- Health check `/health`.
- Tương thích import dữ liệu `data/db.json` cũ nếu file đó tồn tại trong source.

## Render
Tạo Web Service và PostgreSQL cùng region Singapore.
Đặt `DATABASE_URL` bằng Internal Database URL của PostgreSQL (hoặc dùng Blueprint ở `render.yaml`).
Đặt `ADMIN_USER`, `ADMIN_PASSWORD` (ít nhất 12 ký tự), và `OPENAI_API_KEY`.

> Lưu ý: Render Free Postgres có giới hạn/thời hạn theo chính sách của Render. Kiểm tra plan hiện tại trước khi dùng dữ liệu quan trọng.
