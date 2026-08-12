export function parseBookingFormConstraints(constraints) {
  const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
  const isValid =
    isPositiveInteger(constraints?.personName?.minLength) &&
    isPositiveInteger(constraints?.personName?.maxLength) &&
    constraints.personName.minLength <= constraints.personName.maxLength &&
    typeof constraints.personName.pattern === "string" &&
    typeof constraints.personName.message === "string" &&
    isPositiveInteger(constraints?.phone?.minLength) &&
    isPositiveInteger(constraints?.phone?.maxLength) &&
    constraints.phone.minLength <= constraints.phone.maxLength &&
    typeof constraints.phone.pattern === "string" &&
    typeof constraints.phone.message === "string" &&
    isPositiveInteger(constraints?.email?.maxLength) &&
    isPositiveInteger(constraints?.customVenueName?.minLength) &&
    isPositiveInteger(constraints?.customVenueName?.maxLength) &&
    constraints.customVenueName.minLength <= constraints.customVenueName.maxLength &&
    isPositiveInteger(constraints?.note?.maxLength);

  if (!isValid) throw new Error("Sunucudan geçerli form doğrulama koşulları alınamadı.");
  try {
    new RegExp(constraints.personName.pattern, "u");
    new RegExp(constraints.phone.pattern);
    new RegExp(constraints.personName.pattern, "v");
    new RegExp(constraints.phone.pattern, "v");
  } catch {
    throw new Error("Sunucudan geçerli form doğrulama koşulları alınamadı.");
  }
  return constraints;
}

export function applyBookingFormConstraints(root, constraints) {
  const apply = (selector, config) => {
    root.querySelectorAll(selector).forEach((input) => {
      if (config.minLength !== undefined) input.minLength = config.minLength;
      if (config.maxLength !== undefined) input.maxLength = config.maxLength;
      if (config.pattern) input.pattern = config.pattern;
    });
  };
  apply(
    'input[name="brideFirstName"], input[name="brideLastName"], input[name="groomFirstName"], input[name="groomLastName"], input[name="firstName"], input[name="lastName"]',
    constraints.personName
  );
  apply(
    'input[name="bridePhone"], input[name="groomPhone"], input[name="phone"]',
    constraints.phone
  );
  apply('input[name="primaryEmail"]', constraints.email);
  apply('input[name="customVenueName"]', constraints.customVenueName);
  apply('textarea[name="note"]', constraints.note);
}
