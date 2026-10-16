// When the keyboard's key card is up (ui/hud.ts KeyCard; docs/wip/v08-a.md section 2). Pure: no DOM,
// so Node tests drive it (tools/bench/test/app-play.test.ts).
//
// The card shows by itself while the craft waits on the ground for a start ("ground"), and K
// (keymap help.keys) toggles what the player sees now: a card that is up goes away, one that is not
// comes up and stays (pinned) through the flight until K again. Hidden on the ground, it stays
// hidden until that wait is over; the next wait (a respawn that needs a start) shows it again.
// The first version only flipped the pin, so K pressed over the ground card changed nothing on
// screen and pinned the card over the flight that followed (the review of 2026-10-16).

export class KeyCardShow {
    private pinned = false;
    /** K hid the ground card: it stays hidden until the ground wait is over */
    private dismissed = false;
    private ground = false;

    /** Is the card up in this frame? `ground`: the craft waits on the ground for a start (the card's own reason to show). */
    shown(ground: boolean): boolean {
        this.ground = ground;
        if (!ground) this.dismissed = false;
        return (ground && !this.dismissed) || this.pinned;
    }

    /** K: hide the card when it is up, show and pin it when it is not. Returns whether it is up now. */
    toggle(): boolean {
        if ((this.ground && !this.dismissed) || this.pinned) {
            this.pinned = false;
            this.dismissed = this.ground;
            return false;
        }
        this.pinned = true;
        return true;
    }
}
