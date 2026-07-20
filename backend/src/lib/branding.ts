/**
 * Deployment-supplied naming, injected as Lambda environment variables by
 * Terraform from the active profile's cabin.config.json. The fallbacks keep
 * local runs and tests working without a profile.
 */
export const APP_NAME = process.env.APP_NAME || "The Cabin";
export const PROPERTY_NOUN = process.env.PROPERTY_NOUN || "cabin";
export const PRIORITY_USER_LABEL = process.env.PRIORITY_USER_LABEL || "the priority member";
export const PRIORITY_USER_LABEL_POSSESSIVE =
  process.env.PRIORITY_USER_LABEL_POSSESSIVE || "the priority member's";
