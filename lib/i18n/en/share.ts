// The WhatsApp message itself, per tone. {name} and {shop} are as typed; {what} is the bold
// amount with the item list; {amount} is "RM 12.50".
export const share = {
  "msg.friendly.intro": "Hi {name}, {shop} here 🙂 Just a friendly note: your tab is {what}.",
  "msg.friendly.payLine": "Pay easily with PayPal or card:",
  "msg.polite.intro": "Hello {name}, this is {shop}. A gentle reminder that your tab of {what} is still open. Please settle it when you can.",
  "msg.polite.payLine": "You can pay with PayPal or card here:",
  "msg.firm.intro": "Hi {name}, this is {shop}. Your tab of {what} is long overdue. Please pay it this week.",
  "msg.firm.payLine": "Pay with PayPal or card here:",
  "msg.partialPayLine": "{amount} of this can be paid here:",
  "msg.closing": "Thank you!",
  "msg.nameFallback": "there",
  "msg.shopFallback": "your shop",
  "msg.items.two": "{a} and {b}",
  "msg.items.list": "{list} and {last}",
  "msg.items.more": "{list} and {count} more",
  "msg.items.sep": ", ",
} as const;
