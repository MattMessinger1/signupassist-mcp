export const skiClubProConfig = {
  loginUrl: "https://blackhawk.skiclubpro.team/user/login",
  selectors: {
    username: 'input[name="name"]',
    password: 'input[name="pass"]',
    submit: 'input#edit-submit'
  },
  postLoginCheck: 'text=Logout'
};
