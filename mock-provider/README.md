# Mock SkiClubPro Provider

A mock login server for testing the credential flow.

## Setup

```bash
cd mock-provider
npm install
npm start
```

The server will run on http://localhost:4321

## Test Credentials

- **Email**: parent@example.com
- **Password**: password123
- **2FA Code**: 654321

## Endpoints

- `GET /user/login` - Login form
- `POST /user/login` - Submit credentials
- `GET /twofactor` - 2FA challenge page
- `POST /twofactor` - Submit 2FA code
- `GET /dashboard` - Success page

## Testing the Flow

1. Navigate to http://localhost:4321/user/login
2. Enter test credentials
3. Complete 2FA challenge with code 654321
4. See success dashboard
