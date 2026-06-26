# Contest API Flow For Frontend

Base URL local:

```text
http://localhost:3000/api/v1
```

Auth header cho API protected:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

Response chuẩn:

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

Khi lỗi:

```json
{
  "success": false,
  "code": "CONTEST_CAPACITY_FULL",
  "message": "Contest đã đủ số lượng đăng ký"
}
```

## 1. Vai trò trong luồng contest

| Role | Làm được gì |
|---|---|
| Public/Guest | Xem danh sách contest, chi tiết contest, leaderboard, rewards |
| CUSTOMER | Đăng ký contest, hủy đăng ký của mình, xem reward claim của mình |
| PROVIDER | Tạo contest, mở/hủy contest, quản lý đăng ký, check-in, tạo bracket, nhập/verify kết quả, publish leaderboard, phát thưởng |
| STAFF | Check-in participant, tạo heat/bracket/result nếu staff thuộc cafe tham gia contest |

Quy tắc quan trọng:

- Chỉ `PROVIDER` active tạo được contest.
- `STAFF` không tạo contest.
- Provider chỉ chọn được cafe `ACTIVE` thuộc chính provider đó.
- Customer đăng ký ở cấp contest, không chọn chi nhánh khi đăng ký.
- Check-in phải ở cafe thuộc `contest_cafes`.
- Provider có thể đăng ký contest của provider khác, nhưng không được tự đăng ký contest do mình tạo.

## 2. Flow public cho trang FE

### 2.1 Trang danh sách contest

```http
GET /contests?page=1&limit=20&upcoming=true&notify_within_hours=72
```

Query:

| Field | Type | Ghi chú |
|---|---|---|
| `page` | number | Default `1` |
| `limit` | number | Default `20`, max `100` |
| `status` | `OPEN`, `CLOSED`, `RUNNING`, `COMPLETED`, `CANCELLED`, `DRAFT` | Guest chỉ thấy public status |
| `upcoming` | `true`/`false` | Lọc contest sắp diễn ra |
| `notify_within_hours` | number | FE dùng `should_notify` để hiện popup |

Response item chính:

```json
{
  "id": "contest-id",
  "provider_id": "provider-id",
  "name": "Postman Demo Knockout",
  "description": "Runtime contest",
  "track_type_id": "track-type-id",
  "starts_at": "2026-06-18T15:00:00.000Z",
  "ends_at": "2026-06-18T21:00:00.000Z",
  "registration_opens_at": "2026-06-11T15:00:00.000Z",
  "registration_closes_at": "2026-06-18T14:00:00.000Z",
  "capacity": 8,
  "entry_fee": 0,
  "status": "OPEN",
  "banner_image_url": "https://...",
  "config": {},
  "participating_cafes": [
    {
      "id": "cafe-id",
      "name": "Contest Demo Arena",
      "slug": "contest-demo-arena",
      "status": "ACTIVE",
      "city": "Ho Chi Minh",
      "district": "Quan Demo"
    }
  ],
  "registration_summary": {
    "total": 8,
    "active": 8,
    "checked_in": 0
  },
  "remaining_capacity": 0,
  "is_registration_open": true,
  "should_notify": true
}
```

FE gợi ý:

- Nếu `should_notify = true` và user chưa dismiss popup: hiện modal/banner tham gia sự kiện.
- CTA popup:
  - Guest: chuyển login/register.
  - Customer/Provider khác: gọi `POST /contests/:id/register`.
  - Provider owner: chuyển trang quản lý contest.
- Button đăng ký enable khi `is_registration_open = true` và `remaining_capacity > 0`.

### 2.2 Trang contest theo cafe

```http
GET /cafes/:cafeId/contests?page=1&limit=20&upcoming=true
```

Dùng cho cafe detail page. Endpoint chỉ trả contest có cafe đó trong danh sách chi nhánh tham gia.

### 2.3 Trang chi tiết contest

```http
GET /contests/:id?notify_within_hours=72
```

Dùng để render hero, countdown đăng ký, danh sách cafe tham gia, capacity, leaderboard/rewards.

## 3. Auth flow demo

```http
POST /auth/login
```

Body:

```json
{
  "email": "customer@gmail.com",
  "password": "123456"
}
```

Demo accounts cho contest:

| Role | Email | Password |
|---|---|---|
| Provider | `contest_provider@gmail.com` | `123456` |
| Staff | `contest_staff@gmail.com` | `123456` |
| Player 01-08 | `contest_player01@gmail.com` ... `contest_player08@gmail.com` | `123456` |

Chạy seed demo:

```bash
npm run migration:run
npm run seed:contest-demo
```

## 4. Provider management flow

### 4.1 Provider lấy track type và cafe của mình

```http
GET /track-types
GET /cafes?scope=managed&status=ACTIVE&limit=10
```

FE cần lưu:

- `track_type_id`
- `participating_cafe_ids`

### 4.2 Tạo contest draft

```http
POST /contests
```

Auth: `PROVIDER`

Body:

```json
{
  "name": "RCField Summer Knockout",
  "description": "Giai dau demo 8 nguoi",
  "track_type_id": "track-type-id",
  "vehicle_rule": {
    "source": "BYOC",
    "note": "BYOC only"
  },
  "starts_at": "2026-06-18T09:00:00.000Z",
  "ends_at": "2026-06-18T15:00:00.000Z",
  "registration_opens_at": "2026-06-11T09:00:00.000Z",
  "registration_closes_at": "2026-06-18T08:00:00.000Z",
  "capacity": 8,
  "entry_fee": 0,
  "banner_image_url": "https://cdn.rcfield.vn/contests/demo.jpg",
  "config": {
    "bracket_size": 8
  },
  "participating_cafe_ids": ["cafe-id-1", "cafe-id-2"]
}
```

Response status ban đầu là `DRAFT`.

Validation chính:

- `ends_at` phải sau `starts_at`.
- `registration_closes_at` phải sau `registration_opens_at`.
- `registration_closes_at` không được sau `starts_at`.
- `participating_cafe_ids` tối thiểu 1 cafe.

### 4.3 Cập nhật contest draft

```http
PATCH /contests/:id
```

Auth: `PROVIDER owner`

Body là partial của create body:

```json
{
  "capacity": 16,
  "description": "Cap nhat capacity"
}
```

Lưu ý: đổi `participating_cafe_ids` chỉ nên làm khi contest còn `DRAFT`.

### 4.4 Mở đăng ký

```http
POST /contests/:id/open
```

Auth: `PROVIDER owner`

Body:

```json
{}
```

Sau khi mở, status thành `OPEN`, public list bắt đầu thấy contest.

### 4.5 Hủy contest

```http
POST /contests/:id/cancel
```

Auth: `PROVIDER owner`

Khi hủy contest, active registrations chuyển `CANCELLED`.

## 5. Participant registration flow

### 5.1 Customer/Provider khác đăng ký

```http
POST /contests/:id/register
```

Auth: `CUSTOMER` hoặc `PROVIDER`

Body BYOC:

```json
{
  "vehicle_source": "BYOC",
  "metadata": {
    "note": "Dang ky tu FE"
  }
}
```

Body rental:

```json
{
  "vehicle_source": "RENTAL",
  "vehicle_id": "vehicle-id"
}
```

Response cần lưu:

```json
{
  "id": "registration-id",
  "contest_id": "contest-id",
  "user_id": "user-id",
  "participant_role_snapshot": "CUSTOMER",
  "vehicle_source": "BYOC",
  "status": "CONFIRMED",
  "check_in_code": "uuid-code"
}
```

FE state:

- Sau khi đăng ký thành công, disable button register.
- Hiển thị trạng thái `CONFIRMED`.
- Lưu `registration_id` nếu cần hủy đăng ký.

Lỗi thường gặp:

| Code | Ý nghĩa | FE nên làm |
|---|---|---|
| `CONTEST_NOT_OPEN` | Contest chưa mở | Disable CTA |
| `CONTEST_REGISTRATION_CLOSED` | Ngoài thời gian đăng ký | Hiển thị hết hạn |
| `CONTEST_CAPACITY_FULL` | Hết slot | Hiển thị full |
| `CONTEST_REGISTRATION_EXISTS` | User đã đăng ký | Chuyển CTA thành đã đăng ký |
| `CONTEST_SELF_REGISTRATION_FORBIDDEN` | Provider owner tự đăng ký contest của mình | Chuyển sang trang quản lý |

### 5.2 Hủy đăng ký

```http
POST /contest-registrations/:id/cancel
```

Auth: participant hoặc provider owner

Body:

```json
{
  "reason": "Ban lich ca nhan"
}
```

Response status thành `CANCELLED`.

## 6. Check-in flow cho Provider/Staff

### 6.1 Provider xem danh sách đăng ký

```http
GET /contests/:id/registrations
```

Auth: `PROVIDER owner`

FE dùng cho màn hình quản lý participant:

- Tìm theo email/name phía FE nếu API chưa có search.
- Filter `CONFIRMED`, `CHECKED_IN`, `CANCELLED`.
- Lấy `registration.id` để check-in.

### 6.2 Check-in participant

```http
POST /contest-registrations/:id/check-in
```

Auth: `PROVIDER owner` hoặc `STAFF`

Body:

```json
{
  "cafe_id": "participating-cafe-id"
}
```

Response:

```json
{
  "id": "registration-id",
  "status": "CHECKED_IN",
  "checked_in_cafe_id": "cafe-id",
  "checked_in_by": "staff-or-provider-id",
  "checked_in_at": "2026-06-11T15:00:00.000Z"
}
```

Rules:

- Chỉ check-in registration `CONFIRMED`.
- `cafe_id` phải thuộc contest.
- Staff phải được assign tại cafe đó.

## 7. Competition flow: class, round, heat, result

Phần này dành cho màn hình vận hành giải.

### 7.1 Tạo class

```http
POST /contests/:id/classes
```

Auth: `PROVIDER`

Body:

```json
{
  "code": "DEMO_KNOCKOUT",
  "name": "Demo Knockout",
  "capacity": 8,
  "rules": {
    "format": "single_elimination"
  },
  "display_order": 0,
  "is_active": true
}
```

Lưu `contest_class_id`.

### 7.2 Tạo round

```http
POST /contests/:id/rounds
```

Auth: `PROVIDER`

Body:

```json
{
  "contest_class_id": "class-id",
  "round_type": "QUALIFYING",
  "round_no": 1,
  "name": "Quarter Final",
  "rules": {
    "bracket": true
  }
}
```

Enum hiện có:

- `PRACTICE`
- `QUALIFYING`
- `FINAL`

Gợi ý mapping bracket:

| Stage | round_type | round_no |
|---|---|---|
| Quarter Final | `QUALIFYING` | `1` |
| Semi Final | `QUALIFYING` | `2` |
| Final | `FINAL` | `1` |

### 7.3 Tạo heat và result nếu dùng timing/leaderboard

```http
POST /contest-rounds/:id/heats
```

Body:

```json
{
  "heat_no": 1,
  "config": {
    "lane_count": 2
  }
}
```

Thêm participant vào heat:

```http
POST /contest-heats/:id/entries
```

Body:

```json
{
  "registration_id": "registration-id",
  "contest_class_id": "class-id",
  "grid_position": 1
}
```

Submit result:

```http
POST /contest-heats/:id/results
```

TIME_ATTACK:

```json
{
  "result_type": "TIME_ATTACK",
  "results": [
    {
      "heat_entry_id": "entry-id",
      "best_lap_ms": 45230,
      "total_time_ms": 190000,
      "laps_completed": 4,
      "penalty_ms": 0
    }
  ]
}
```

RACE_FINAL:

```json
{
  "result_type": "RACE_FINAL",
  "results": [
    {
      "heat_entry_id": "entry-id",
      "finish_position": 1,
      "total_time_ms": 180000
    }
  ]
}
```

Verify result:

```http
POST /contest-results/:id/verify
```

Body:

```json
{}
```

Leaderboard chỉ tính result đã `VERIFIED`.

## 8. Bracket knockout flow

Bracket dùng `contest_bracket_matches` để đánh dấu thắng/thua và đẩy winner sang vòng sau.

### 8.1 Tạo match

```http
POST /contest-rounds/:id/bracket-matches
```

Auth: `PROVIDER` hoặc `STAFF`

Body match chưa có competitor:

```json
{
  "match_no": 1,
  "metadata": {
    "stage": "FINAL"
  }
}
```

Body match có competitor và next match:

```json
{
  "match_no": 1,
  "competitor_a_registration_id": "player-01-registration-id",
  "competitor_b_registration_id": "player-02-registration-id",
  "next_match_id": "semi-match-id",
  "next_slot": "A",
  "metadata": {
    "stage": "QUARTER_FINAL"
  }
}
```

Response cần lưu:

```json
{
  "id": "match-id",
  "contestId": "contest-id",
  "contestRoundId": "round-id",
  "matchNo": 1,
  "competitorARegistrationId": "registration-a",
  "competitorBRegistrationId": "registration-b",
  "winnerRegistrationId": null,
  "loserRegistrationId": null,
  "nextMatchId": "next-match-id",
  "nextSlot": "A",
  "status": "SCHEDULED"
}
```

### 8.2 Decide winner

```http
POST /contest-bracket-matches/:id/decide
```

Body:

```json
{
  "winner_registration_id": "winner-registration-id",
  "metadata": {
    "score": "2-1"
  }
}
```

Rules:

- Winner phải là `competitor_a_registration_id` hoặc `competitor_b_registration_id`.
- Match đã `COMPLETED` không decide lại được.
- Nếu match có `next_match_id` và `next_slot`, BE tự gán winner vào slot `A` hoặc `B` của next match.

### 8.3 Flow tạo bracket 8 người

Thứ tự FE nên gọi:

1. Tạo `FINAL` round, tạo final match trống, lưu `final_match_id`.
2. Tạo `SEMI_FINAL` round, tạo 2 semi match trống:
   - Semi 1: `next_match_id = final_match_id`, `next_slot = A`
   - Semi 2: `next_match_id = final_match_id`, `next_slot = B`
3. Tạo 4 quarter match:
   - Q1: player 1 vs player 2, next semi 1 slot A
   - Q2: player 3 vs player 4, next semi 1 slot B
   - Q3: player 5 vs player 6, next semi 2 slot A
   - Q4: player 7 vs player 8, next semi 2 slot B
4. Decide Q1-Q4. BE tự fill competitor vào semi.
5. Decide Semi 1-2. BE tự fill competitor vào final.
6. Decide Final. `winnerRegistrationId` là champion.

Lưu ý hiện tại chưa có endpoint list bracket matches, nên FE cần giữ `match_id` sau khi tạo. Nếu cần render lại bracket sau refresh, nên bổ sung API list bracket matches ở phase tiếp theo.

## 9. Leaderboard và reward flow

### 9.1 Xem leaderboard

```http
GET /contests/:id/leaderboard
```

Response:

```json
{
  "success": true,
  "data": {
    "standings": [
      {
        "registration_id": "registration-id",
        "user_id": "user-id",
        "rank": 1,
        "best_lap_ms": 45230,
        "total_time_ms": 180000,
        "points": null
      }
    ]
  }
}
```

### 9.2 Publish leaderboard snapshot

```http
POST /contests/:id/leaderboard/publish
```

Auth: `PROVIDER`

Body:

```json
{
  "contest_class_id": "class-id",
  "scope": "OVERALL"
}
```

### 9.3 Tạo reward

```http
POST /contests/:id/rewards
```

Auth: `PROVIDER`

Body:

```json
{
  "contest_class_id": "class-id",
  "title": "Champion Trophy",
  "description": "Cup vo dich demo",
  "reward_type": "TROPHY",
  "position": 1,
  "quantity": 1,
  "is_published": true,
  "metadata": {
    "voucher_code": "CHAMPION2026"
  }
}
```

Reward type:

- `TROPHY`
- `VOUCHER`
- `MERCHANDISE`
- `POINTS`
- `OTHER`

### 9.4 Public list rewards

```http
GET /contests/:id/rewards
```

### 9.5 Issue reward claims

```http
POST /contests/:id/rewards/issue
```

Auth: `PROVIDER`

Body:

```json
{
  "contest_class_id": "class-id"
}
```

### 9.6 User xem reward claims của mình

```http
GET /me/contest-reward-claims
```

Auth: `CUSTOMER` hoặc `PROVIDER`

## 10. UI state machine gợi ý cho FE

### Contest card CTA

| Backend state | FE state |
|---|---|
| `status = DRAFT` | Không hiển thị public |
| `status = OPEN`, `is_registration_open = true`, còn slot | Hiện nút `Tham gia` |
| `status = OPEN`, hết slot | Hiện `Đã đủ người` |
| `status = CLOSED` | Hiện `Đã đóng đăng ký` |
| `status = RUNNING` | Hiện `Đang diễn ra` |
| `status = COMPLETED` | Hiện `Xem kết quả` |
| `status = CANCELLED` | Ẩn hoặc badge `Đã hủy` |

### Registration badge

| Registration status | FE label |
|---|---|
| `CONFIRMED` | Đã đăng ký |
| `CHECKED_IN` | Đã check-in |
| `CANCELLED` | Đã hủy |
| `PENDING` | Chờ xác nhận |

### Popup sự kiện

FE gọi:

```http
GET /contests?upcoming=true&status=OPEN&notify_within_hours=72
```

Điều kiện hiện popup:

- Có item `should_notify = true`.
- User chưa dismiss contest đó trong localStorage/session.
- User chưa đăng ký contest đó nếu FE có state đăng ký.

Gợi ý localStorage:

```text
contest_popup_dismissed:<contest_id> = true
```

## 11. Postman automation

Collection:

```text
postman/RCField-Contests.postman_collection.json
```

Folder quan trọng cho FE/dev test:

```text
Demo Seed Accounts
```

Chạy tự động:

```bash
npx newman run postman/RCField-Contests.postman_collection.json --folder "Demo Seed Accounts" --env-var baseUrl=http://localhost:3000/api/v1 --env-var password=123456
```

Folder này test đủ:

- Login provider/staff/8 players.
- Tạo contest runtime.
- Mở contest.
- 8 players đăng ký.
- Staff check-in 8 players.
- Tạo class/round/bracket.
- Decide quarter final, semi final, final.
- Assert winner/loser và advancement.

## 12. Thiếu API nên cân nhắc phase tiếp theo

Các API hiện chưa có nhưng FE bracket page sẽ cần nếu muốn refresh/render đầy đủ:

- `GET /contests/:id/classes`
- `GET /contests/:id/rounds`
- `GET /contest-rounds/:id/bracket-matches`
- `GET /contests/:id/bracket`
- `GET /me/contest-registrations`
- Search/filter registrations theo name/email/status.

Hiện tại Postman demo vẫn chạy được vì lưu ID theo flow tạo mới trong collection.
