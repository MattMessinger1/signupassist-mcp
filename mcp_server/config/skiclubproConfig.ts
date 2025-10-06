export const skiClubProConfig = {
  loginUrl: "https://blackhawk.skiclubpro.team/user/login?destination=/dashboard",
  selectors: {
    username: '#edit-name, input[name="name"], input[type="email"], input[name*="email" i], input[name="username"], input[name="user"]',
    password: '#edit-pass, input[name="pass"], input[type="password"], input[name*="password" i]',
    submit: '#edit-submit, button#edit-submit, input[type="submit"], button[type="submit"]'
  },
  postLoginCheck: 'text=Logout',
  timeout: 30000 // Increased timeout for slow-loading pages
};
