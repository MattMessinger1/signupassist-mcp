export const skiClubProConfig = {
  loginUrl: "https://blackhawk.skiclubpro.team/user/login?destination=/dashboard",
  selectors: {
    username: '#edit-name, input[name="name"]',
    password: '#edit-pass, input[name="pass"]',
    submit: '#edit-submit, button#edit-submit, input[type="submit"]'
  },
  postLoginCheck: 'text=Logout'
};
