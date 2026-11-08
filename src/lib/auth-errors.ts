/** Supabase auth error messages → friendly Hebrew. */
export function authErrorHe(message: string) {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "המייל או הסיסמה שגויים.";
  if (m.includes("already registered") || m.includes("already been registered")) return "המייל הזה כבר רשום. נסה להתחבר.";
  if (m.includes("not confirmed")) return "צריך לאשר את המייל קודם. בדוק את תיבת הדואר (וגם את הספאם).";
  if (m.includes("password") && m.includes("6")) return "הסיסמה צריכה להכיל לפחות 6 תווים.";
  if (m.includes("rate limit") || m.includes("too many") || m.includes("security purposes"))
    return "יותר מדי ניסיונות. חכה כמה דקות ונסה שוב.";
  if (m.includes("invalid email") || m.includes("unable to validate email")) return "כתובת המייל לא תקינה.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "ההרשמה סגורה כרגע.";
  if (m.includes("fetch")) return "אין חיבור לשרת. בדוק את האינטרנט.";
  return message;
}
