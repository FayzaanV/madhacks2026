import type { Metadata } from "next";

export const metadata: Metadata = { title: "Help · Yomi" };

export default function HelpPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-10 py-4">
      <h1 className="display text-4xl sm:text-5xl">Help</h1>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">Creating an Account</h2>
        <p className="leading-relaxed">
          In order to place bets and to create events other people can bet on, you must be logged in to an account. To create an
          account, select your school and enter your .edu email. A confirmation email will be sent. Click the link in the email to
          confirm your email, create your account, and login. Every new account starts with 100 clout. This shows other people how
          accurate you are with your predictions, and can be used to unlock prestigious items in the shop.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">Placing Bets</h2>
        <p className="leading-relaxed">
          Instead of real money, bets can be placed with your clout. You are able to bet up to all of your clout on any one event.
          There are multipliers depending on likelihood. When placing your bet, it will show you how much clout you will win if you
          predict correctly. If you predict incorrectly, you will lose all the clout you wagered. It is possible to have negative
          clout. In this case, you may wager up to 10 clout across any number of events. You will still lose however many clout you
          wager.
        </p>
        <p className="leading-relaxed">
          Clout can be used for bragging rights, or to unlock prestigious items in the shop. The leaderboard will show who has the
          most clout at your university, and the top and bottom 5 are pinned to the home screen. If the probability trends in your
          direction, you can sell bets before they resolve. Your profile will show your history of clout transactions.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">Creating Events</h2>
        <p className="leading-relaxed">
          Anyone can create events to bet on for almost anything. Classes, Big 10 sports, intramurals, almost anything about campus
          life. You cannot create bets about individual students, unless it is a private event only viewable by your friends. If you
          try to create a bet that already exists, it will not be posted and will redirect you to the bet that is already live.
        </p>
        <p className="leading-relaxed">
          When you create a bet, you decide what category it is in. You can also be responsible for resolving it. That means that
          when the event you’re predicting happens, you can be responsible for putting the outcome in Yomi so our system can
          distribute clout. On the page of the event, there is a button to resolve on the right hand sidebar. You can view all the
          events you create on your profile.
        </p>
      </section>
    </article>
  );
}
