# 7A6 Study Bot — Gemini Edition

Bản hoàn chỉnh dùng Express + PostgreSQL + Gemini API, tối ưu cho Render.

## Cài đặt

```bash
npm install
npm start
```

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string
- `GEMINI_API_KEY` — Gemini API key
- `GEMINI_MODEL` — mặc định `gemini-3.8-flash`
- `ADMIN_USER`
- `ADMIN_PASSWORD` — tối thiểu 12 ký tự khi chạy trên Render

## Render

`render.yaml` đã cấu hình PostgreSQL và các biến Gemini. Sau khi tạo Web Service từ repo, đặt `GEMINI_API_KEY` trong Environment Variables.

API key chỉ được dùng ở server, không đưa vào frontend.
