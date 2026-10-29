-- A description of an event's image for screen readers (UI-018), shown as the
-- event page hero's alt text. Null when there is no image or it is decoration.
-- Additive.
ALTER TABLE "Event" ADD COLUMN "heroAlt" TEXT;
