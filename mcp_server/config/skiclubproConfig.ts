export const skiClubProConfig = {
  loginUrl: "https://blackhawk.skiclubpro.team/user/login",
  selectors: {
    username: '#edit-name, input[name="name"], input[type="email"], input[name*="email" i], input[name="username"], input[name="user"]',
    password: '#edit-pass, input[name="pass"], input[type="password"], input[name*="password" i]',
    rememberMe: 'input[name="persistent_login"], input[type="checkbox"][name="remember_me"], input#edit-remember-me, label:has-text("Remember me") input[type="checkbox"]',
    submit: '#edit-submit, button#edit-submit, input[type="submit"], button[type="submit"]'
  },
  postLoginCheck: 'text=Logout',
  timeout: 30000 // Increased timeout for slow-loading pages
};
