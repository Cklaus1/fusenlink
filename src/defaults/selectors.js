/**
 * Default selector registries — extracted from LinkedIn's DOM patterns.
 * Each key maps to an ordered list of strategies tried in sequence.
 *
 * Strategy types:
 *   css          - document.querySelectorAll(value)
 *   cssWithText  - querySelectorAll(value) then filter by text content
 *   ariaLabel    - querySelectorAll(value) then filter by aria-label pattern
 *   textExact    - querySelectorAll(value) then filter where trimmed text === text
 *   textMatch    - querySelectorAll(value) then filter where text includes match
 *   hasChild     - querySelectorAll(value) for parent, using countDivisor for card counting
 *
 * Scopes: document (default), modal, dropdown
 * Filters: visible, enabled, notAriaHidden, notExtensionUI, notDisabledClass
 */

export const DEFAULT_SELECTOR_REGISTRIES = {
  'linkedin.invitations': {
    version: 2,
    invitationCard: {
      strategies: [
        { type: 'css', value: '[data-view-name="pending-invitation"]' },
        { type: 'css', value: '[data-view-name*="invitation"]' },
        { type: 'css', value: '.invitation-card__container' },
        { type: 'css', value: '[class*="invitation-card"]' }
      ]
    },
    invitationCardByButtons: {
      strategies: [{ type: 'css', value: 'button[data-view-name="invitation-action"]' }],
      countDivisor: 2
    },
    acceptButton: {
      strategies: [
        { type: 'cssWithText', value: 'button[data-view-name="invitation-action"]', text: 'Accept' },
        { type: 'ariaLabel', value: 'button', pattern: 'accept' },
        { type: 'textExact', value: 'button', text: 'Accept' }
      ],
      filters: ['visible', 'enabled', 'notAriaHidden']
    },
    ignoreButton: {
      strategies: [
        { type: 'cssWithText', value: 'button[data-view-name="invitation-action"]', text: 'Ignore' },
        { type: 'ariaLabel', value: 'button', pattern: 'ignore' },
        { type: 'textExact', value: 'button', text: 'Ignore' }
      ],
      filters: ['visible', 'enabled', 'notAriaHidden']
    },
    dismissButton: {
      strategies: [
        { type: 'css', value: 'button[aria-label="Dismiss"]' },
        { type: 'css', value: 'button[aria-label="Close"]' }
      ],
      scope: 'modal'
    },
    securityChallenge: {
      strategies: [{ type: 'css', value: 'iframe[src*="challenge"]' }]
    },
    securityMessage: {
      strategies: [
        { type: 'css', value: '[role="dialog"],[role="alert"],.artdeco-modal,.challenge-page,.error-message,.captcha-container' }
      ],
      textPatterns: ['security check', 'verify you are not a robot', 'unusual amount of activity', 'too many requests', 'rate limit exceeded', 'try again later']
    }
  },

  'linkedin.search': {
    version: 3,
    searchResultCard: {
      strategies: [
        // 2026 lite UI: results live inside a lazy-column with role=list
        { type: 'css', value: '[data-testid="lazy-column"] [role="listitem"]' },
        { type: 'css', value: 'main [role="list"] > [role="listitem"]' },
        { type: 'css', value: 'main [role="listitem"]' },
        // Legacy fallbacks
        { type: 'css', value: '.reusable-search__result-container' },
        { type: 'css', value: '[class*="entity-result"]' },
        { type: 'css', value: 'li[class*="reusable-search__result-container"]' },
        { type: 'css', value: 'li.search-result' },
        { type: 'css', value: '[data-view-name="search-entity-result"]' },
        { type: 'css', value: 'div[data-chameleon-result-urn]' }
      ]
    },
    connectButton: {
      strategies: [
        // 2026 lite UI: Connect is now an <a> element with a preload href
        { type: 'css', value: 'a[href*="/preload/search-custom-invite"]' },
        { type: 'css', value: 'a[aria-label^="Invite"][aria-label$="to connect"]' },
        // Profile-style aria-label (still appears for some surfaces)
        { type: 'css', value: 'button[aria-label^="Invite"][aria-label$="to connect"]' },
        // Legacy fallbacks
        { type: 'textExact', value: 'button,a', text: 'Connect' },
        { type: 'ariaLabel', value: 'a', pattern: 'nvite.*onnect' },
        { type: 'css', value: 'button[aria-label^="Invite"]' },
        { type: 'css', value: 'button[aria-label*="connect"]' },
        { type: 'css', value: '[data-view-name="connect-action"]' },
        { type: 'cssWithText', value: 'button', text: 'connect' }
      ],
      filters: ['visible', 'enabled', 'notAriaHidden', 'notExtensionUI']
    },
    moreButton: {
      strategies: [{ type: 'textMatch', value: 'button', text: 'More' }],
      filters: ['visible', 'notAriaHidden'],
      requiresVerification: 'connectMenuOption'
    },
    connectMenuOption: {
      strategies: [
        { type: 'cssWithText', value: '[role="menuitem"]', text: 'Connect' },
        { type: 'cssWithText', value: '.artdeco-dropdown__content button', text: 'Connect' }
      ],
      filters: ['visible'],
      scope: 'dropdown'
    },
    sendButton: {
      strategies: [
        { type: 'textExact', value: 'button', text: 'Send without a note' },
        { type: 'textMatch', value: 'button', text: 'without' },
        { type: 'textExact', value: 'button', text: 'Send' }
      ],
      scope: 'modal',
      filters: ['visible']
    },
    connectInModal: {
      strategies: [{ type: 'textExact', value: 'button', text: 'Connect' }],
      scope: 'modal',
      filters: ['visible', 'notExtensionUI']
    },
    dismissButton: {
      strategies: [
        { type: 'css', value: 'button[aria-label="Dismiss"]' },
        { type: 'css', value: 'button[aria-label="Close"]' }
      ],
      scope: 'modal'
    },
    nextPageButton: {
      strategies: [
        // 2026 lite UI: Next has no aria-label, only textContent="Next"
        { type: 'cssWithText', value: 'main button', text: 'Next' },
        { type: 'css', value: 'button[aria-label="Next"]' },
        { type: 'css', value: '.artdeco-pagination__button--next' },
        { type: 'css', value: 'a[aria-label="Next"]' },
        { type: 'css', value: 'button[class*="pagination"][class*="next"]' },
        { type: 'cssWithText', value: 'button', text: 'next' }
      ],
      filters: ['visible', 'enabled', 'notDisabledClass']
    },
    securityChallenge: {
      strategies: [{ type: 'css', value: 'iframe[src*="challenge"]' }]
    },
    securityMessage: {
      strategies: [
        { type: 'css', value: '[role="dialog"],[role="alert"],.artdeco-modal,.challenge-page,.error-message,.captcha-container' }
      ],
      textPatterns: ['security check', 'verify you are not a robot', 'unusual amount of activity', 'too many requests', 'rate limit exceeded', 'try again later']
    }
  },

  'linkedin.search-extract': {
    version: 3,
    searchResultCard: {
      strategies: [
        // 2026 lite UI
        { type: 'css', value: '[data-testid="lazy-column"] [role="listitem"]' },
        { type: 'css', value: 'main [role="list"] > [role="listitem"]' },
        { type: 'css', value: 'main [role="listitem"]' },
        // Legacy
        { type: 'css', value: '.reusable-search__result-container' },
        { type: 'css', value: '[class*="entity-result"]' },
        { type: 'css', value: 'li[class*="reusable-search__result-container"]' },
        { type: 'css', value: 'li.search-result' },
        { type: 'css', value: '[data-view-name="search-entity-result"]' },
        { type: 'css', value: 'div[data-chameleon-result-urn]' }
      ]
    },
    cardName: {
      strategies: [
        // 2026 lite UI: text is on the /in/ anchor itself; second anchor for the same /in/ contains pure name (no metadata)
        { type: 'css', value: 'a[href*="/in/"] > span > span' },
        { type: 'css', value: 'p > a[href*="/in/"]' },
        { type: 'css', value: 'a[href*="/in/"]:not([aria-hidden]) span' },
        // Legacy
        { type: 'css', value: '.entity-result__title-text a span[aria-hidden="true"]' },
        { type: 'css', value: '[data-anonymize="person-name"]' },
        { type: 'css', value: '[class*="entity-result__title"] a span[aria-hidden="true"]' },
        { type: 'css', value: 'a[href*="/in/"] span[aria-hidden="true"]' }
      ]
    },
    cardHeadline: {
      strategies: [
        // Legacy
        { type: 'css', value: '.entity-result__primary-subtitle' },
        { type: 'css', value: '[data-anonymize="headline"]' },
        { type: 'css', value: '[class*="entity-result__primary-subtitle"]' },
        { type: 'css', value: '[class*="subtitle"][class*="entity-result"]' }
      ]
    },
    cardLink: {
      strategies: [
        // 2026 lite UI: any /in/ anchor inside the card
        { type: 'css', value: 'a[href*="/in/"]' },
        // Legacy
        { type: 'css', value: '.entity-result__title-text a' },
        { type: 'css', value: '[class*="entity-result__title"] a[href*="/in/"]' }
      ]
    },
    cardLocation: {
      strategies: [
        { type: 'css', value: '.entity-result__secondary-subtitle' },
        { type: 'css', value: '[class*="entity-result__secondary-subtitle"]' },
        { type: 'css', value: '[data-anonymize="location"]' }
      ]
    },
    cardSnippet: {
      strategies: [
        { type: 'css', value: '.entity-result__summary' },
        { type: 'css', value: '[class*="entity-result__summary"]' }
      ]
    },
    nextPageButton: {
      strategies: [
        // 2026 lite UI: Next has no aria-label, only textContent="Next"
        { type: 'cssWithText', value: 'main button', text: 'Next' },
        { type: 'css', value: 'button[aria-label="Next"]' },
        { type: 'css', value: '.artdeco-pagination__button--next' },
        { type: 'css', value: 'button[class*="pagination"][class*="next"]' },
        { type: 'cssWithText', value: 'button', text: 'next' }
      ],
      filters: ['visible', 'enabled', 'notDisabledClass']
    }
  },

  'linkedin.profile': {
    version: 3,
    profileName: {
      strategies: [
        // 2026 lite UI: name is the first <h2> inside <main>
        { type: 'css', value: 'main h2:first-of-type' },
        { type: 'css', value: 'main h2' },
        // Legacy fallbacks
        { type: 'css', value: '.text-heading-xlarge' },
        { type: 'css', value: 'h1[class*="text-heading"]' },
        { type: 'css', value: 'h1' },
        { type: 'css', value: '[data-anonymize="person-name"]' },
        { type: 'css', value: 'main h1' }
      ]
    },
    profileHeadline: {
      strategies: [
        // 2026 lite UI: headline is first <p> in the top-card block (sibling of the visible name div)
        // The h2 with the name is hidden; the visible name lives in a div above the headline <p>.
        // Walk-from-h2 isn't expressible in pure CSS, so we look for the first <p> inside main.
        { type: 'css', value: 'main p:first-of-type' },
        // Legacy fallbacks
        { type: 'css', value: '.text-body-medium[data-anonymize="headline"]' },
        { type: 'css', value: '[data-anonymize="headline"]' },
        { type: 'css', value: '[class*="text-body-medium"][class*="break-words"]' },
        { type: 'css', value: 'main .text-body-medium' }
      ]
    },
    profileLocation: {
      strategies: [
        // 2026 lite UI: location is a <p> in a sibling container after the headline.
        // No CSS hook is reliable; engine should walk up from headline.
        // Legacy fallbacks
        { type: 'css', value: '.text-body-small[data-anonymize="location"]' },
        { type: 'css', value: '[data-anonymize="location"]' },
        { type: 'css', value: 'main .text-body-small.inline.t-black--light' },
        { type: 'css', value: 'main span.text-body-small' }
      ]
    },
    profileAbout: {
      strategies: [
        // Legacy
        { type: 'css', value: '#about ~ .display-flex .pv-shared-text-with-see-more span[aria-hidden="true"]' },
        { type: 'css', value: '[data-anonymize="person-summary-text"]' },
        { type: 'css', value: 'section[id*="about"] span[aria-hidden="true"]' },
        { type: 'css', value: 'div[data-section="summary"] span[aria-hidden="true"]' },
        { type: 'css', value: '[class*="pv-shared-text-with-see-more"] span[aria-hidden="true"]' }
      ]
    },
    profileExperience: {
      strategies: [
        // Legacy
        { type: 'css', value: '#experience ~ .pvs-list__outer-container li.artdeco-list__item' },
        { type: 'css', value: '.pv-experience-section__list-item' },
        { type: 'css', value: 'section[id*="experience"] li.artdeco-list__item' },
        { type: 'css', value: 'div[data-section="experience"] li' },
        { type: 'css', value: '[class*="experience"] li[class*="artdeco-list__item"]' }
      ]
    },
    profileEducation: {
      strategies: [
        // Legacy
        { type: 'css', value: '#education ~ .pvs-list__outer-container li.artdeco-list__item' },
        { type: 'css', value: 'section[id*="education"] li.artdeco-list__item' },
        { type: 'css', value: 'div[data-section="education"] li' },
        { type: 'css', value: '[class*="education"] li[class*="artdeco-list__item"]' }
      ]
    },
    profileSkills: {
      strategies: [
        { type: 'css', value: '#skills ~ .pvs-list__outer-container li.artdeco-list__item span[aria-hidden="true"]' },
        { type: 'css', value: 'section[id*="skills"] li.artdeco-list__item span[aria-hidden="true"]' },
        { type: 'css', value: 'div[data-section="skills"] li span[aria-hidden="true"]' }
      ]
    },
    profileConnections: {
      strategies: [
        // 2026 lite UI: "X followers" under Activity section heading
        { type: 'css', value: 'a[href*="/connections"] strong' },
        { type: 'css', value: 'a[href*="/connections"]' },
        // Legacy
        { type: 'css', value: '.pv-top-card--list-bullet li span.t-bold' },
        { type: 'textMatch', value: 'span', text: 'connections' },
        { type: 'css', value: 'a[href*="/connections"] span.t-bold' },
        { type: 'css', value: '[class*="top-card"] span.t-bold' }
      ]
    },
    profileImage: {
      strategies: [
        // 2026 lite UI: profile photo is identified by src pattern (stable, not class)
        { type: 'css', value: 'main img[src*="profile-displayphoto"]' },
        { type: 'css', value: 'img[src*="profile-displayphoto"]' },
        // Legacy
        { type: 'css', value: '.pv-top-card-profile-picture__image' },
        { type: 'css', value: 'img[data-anonymize="headshot-photo"]' },
        { type: 'css', value: 'img[class*="profile-picture"]' },
        { type: 'css', value: 'main img.evi-image' }
      ]
    },
    mainContent: {
      strategies: [
        { type: 'css', value: 'main' },
        { type: 'css', value: 'main.scaffold-layout__main' },
        { type: 'css', value: '[class*="scaffold-layout__main"]' }
      ]
    },
    messageButton: {
      strategies: [
        // 2026 lite UI: Message is now an <a> with messaging/compose href
        { type: 'css', value: 'a[href*="messaging/compose"][aria-label^="Message"]' },
        { type: 'css', value: 'a[href*="messaging/compose"]' },
        { type: 'css', value: 'a[aria-label^="Message"]' },
        // Legacy
        { type: 'textExact', value: 'button,a', text: 'Message' },
        { type: 'css', value: 'button[aria-label*="Message"]' },
        { type: 'css', value: 'a[aria-label*="Message"]' },
        { type: 'css', value: '[data-view-name="profile-message"]' }
      ],
      filters: ['visible', 'enabled']
    },
    connectButton: {
      strategies: [
        // 2026 lite UI
        { type: 'css', value: 'button[aria-label^="Invite"][aria-label$="to connect"]' },
        { type: 'css', value: 'a[href*="/preload/search-custom-invite"]' },
        // Legacy
        { type: 'textExact', value: 'button,a', text: 'Connect' },
        { type: 'css', value: 'button[aria-label*="connect"]' },
        { type: 'css', value: 'button[aria-label^="Invite"]' },
        { type: 'css', value: '[data-view-name="connect-action"]' },
        { type: 'cssWithText', value: 'button', text: 'connect' }
      ],
      filters: ['visible', 'enabled', 'notExtensionUI']
    },
    recentPost: {
      strategies: [
        // 2026 lite UI: posts in the Activity section appear as listitems within main
        { type: 'css', value: 'main [role="listitem"]' },
        { type: 'css', value: 'main [data-testid="lazy-column"] [role="listitem"]' },
        // Legacy
        { type: 'css', value: '.pv-recent-activity-section__feed-item' },
        { type: 'css', value: '[data-urn*="activity"]' },
        { type: 'css', value: '.feed-shared-update-v2' },
        { type: 'css', value: '[class*="feed-shared-update"]' },
        { type: 'css', value: '[data-urn*="urn:li:activity"]' },
        { type: 'css', value: 'div.occludable-update' }
      ]
    },
    postText: {
      strategies: [
        // Legacy
        { type: 'css', value: '.feed-shared-update-v2__description-wrapper span' },
        { type: 'css', value: '.feed-shared-text' },
        { type: 'css', value: '[class*="feed-shared-text"]' },
        { type: 'css', value: '.update-components-text span[dir="ltr"]' }
      ]
    },
    postStats: {
      strategies: [
        // 2026 lite UI: reactions count is a [role="button"] with the count text
        { type: 'css', value: '[role="button"][aria-label*="reaction"]' },
        // Legacy
        { type: 'css', value: '.social-details-social-counts' },
        { type: 'css', value: '.social-details-social-activity' },
        { type: 'css', value: '[class*="social-details-social-counts"]' },
        { type: 'css', value: '[class*="social-counts"]' },
        { type: 'css', value: 'span[aria-label*="reactions"]' },
        { type: 'css', value: 'button[aria-label*="reactions"]' }
      ]
    },
    likeButton: {
      strategies: [
        // 2026 lite UI: aria-label is "Reaction button state: no reaction" / "thumbs up"
        { type: 'css', value: 'button[aria-label^="Reaction button state"]' },
        { type: 'css', value: 'button[aria-label*="Reaction button"]' },
        // Legacy
        { type: 'css', value: 'button[aria-label*="Like"]' },
        { type: 'css', value: 'button.react-button__trigger[aria-label*="like"]' },
        { type: 'css', value: 'button[aria-label*="like"]' },
        { type: 'css', value: '[class*="reactions-react-button"] button' }
      ],
      filters: ['visible', 'enabled']
    },
    addNoteButton: {
      strategies: [
        { type: 'textExact', value: 'button', text: 'Add a note' },
        { type: 'css', value: 'button[aria-label="Add a note"]' },
        { type: 'cssWithText', value: 'button', text: 'add a note' }
      ],
      scope: 'modal',
      filters: ['visible']
    },
    noteTextarea: {
      strategies: [
        { type: 'css', value: 'textarea[name="message"]' },
        { type: 'css', value: '#custom-message' },
        { type: 'css', value: 'textarea[id*="custom-message"]' }
      ],
      scope: 'modal'
    },
    sendConnectButton: {
      strategies: [
        { type: 'textExact', value: 'button', text: 'Send' },
        { type: 'css', value: 'button[aria-label="Send invitation"]' },
        { type: 'css', value: 'button[aria-label^="Send"]' },
        { type: 'cssWithText', value: 'button', text: 'send' }
      ],
      scope: 'modal',
      filters: ['visible', 'enabled']
    }
  },

  'linkedin.messaging': {
    version: 2,
    conversationItem: {
      strategies: [
        { type: 'css', value: 'li.msg-conversation-listitem' },
        { type: 'css', value: '.msg-conversation-listitem' },
        { type: 'css', value: 'div[class*="msg-conversation-listitem"]' },
        { type: 'css', value: '[class*="msg-conversation-listitem"]' },
        { type: 'css', value: '[data-test-id*="conversation-list-item"]' },
        { type: 'css', value: 'li[class*="msg-conversation-card"]' }
      ]
    },
    conversationName: {
      strategies: [
        { type: 'css', value: '.msg-conversation-listitem__participant-names' },
        { type: 'css', value: 'h3.msg-conversation-listitem__title' },
        { type: 'css', value: '[class*="msg-conversation-listitem__participant-names"]' },
        { type: 'css', value: '[class*="msg-conversation-card__participant"]' },
        { type: 'css', value: '[data-test-id*="participant-name"]' }
      ]
    },
    conversationPreview: {
      strategies: [
        { type: 'css', value: '.msg-conversation-listitem__message-snippet' },
        { type: 'css', value: '[class*="msg-conversation-listitem__message-snippet"]' },
        { type: 'css', value: '[class*="msg-conversation-card__message"]' },
        { type: 'css', value: '[data-test-id*="message-snippet"]' }
      ]
    },
    conversationTime: {
      strategies: [
        { type: 'css', value: '.msg-conversation-listitem__time-stamp' },
        { type: 'css', value: '[class*="msg-conversation-listitem__time-stamp"]' },
        { type: 'css', value: '[class*="msg-conversation-card__time"]' },
        { type: 'css', value: 'time' }
      ]
    },
    conversationUnread: {
      strategies: [
        { type: 'css', value: '.msg-conversation-listitem__unread-count' },
        { type: 'css', value: '[class*="msg-conversation-listitem__unread"]' },
        { type: 'css', value: '[class*="unread-count"]' },
        { type: 'css', value: '[data-test-id*="unread-badge"]' }
      ]
    },
    messageInput: {
      strategies: [
        { type: 'css', value: '.msg-form__contenteditable' },
        { type: 'css', value: '[role="textbox"][contenteditable="true"]' },
        { type: 'css', value: '[class*="msg-form__contenteditable"]' },
        { type: 'css', value: 'div[contenteditable="true"][aria-label*="message"]' }
      ]
    },
    sendMessageButton: {
      strategies: [
        { type: 'css', value: '.msg-form__send-button' },
        { type: 'textExact', value: 'button', text: 'Send' },
        { type: 'css', value: 'button[class*="msg-form__send-button"]' },
        { type: 'css', value: 'button[type="submit"][class*="msg-form"]' },
        { type: 'cssWithText', value: 'button', text: 'send' }
      ],
      filters: ['visible', 'enabled']
    }
  },

  'linkedin.connections': {
    version: 3,
    connectionCard: {
      strategies: [
        // 2026 lite UI: card has a "More actions for X" button — locate via that aria-label and walk up if needed
        // The card itself is the closest ancestor div containing both the More-actions button and an /in/ link
        { type: 'css', value: '[data-testid="lazy-column"] > div > div:has(a[href*="/in/"]):has(button[aria-label^="More actions"])' },
        { type: 'css', value: 'main div:has(> a[href*="/in/"]):has(button[aria-label^="More actions"])' },
        { type: 'css', value: '[data-testid="lazy-column"] [role="listitem"]' },
        // Legacy
        { type: 'css', value: 'li.mn-connection-card' },
        { type: 'css', value: '.mn-connection-card' },
        { type: 'css', value: 'div[class*="connection-card"]' },
        { type: 'css', value: 'div[data-test-id*="connection"]' },
        { type: 'css', value: '.scaffold-finite-scroll__content li' },
        { type: 'css', value: 'li[class*="mn-connection-card"]' }
      ]
    },
    connectionName: {
      strategies: [
        // 2026 lite UI: name is text content of the visible /in/ anchor
        { type: 'css', value: 'a[href*="/in/"] p' },
        { type: 'css', value: 'main p:first-of-type' },
        // Legacy
        { type: 'css', value: '.mn-connection-card__name' },
        { type: 'css', value: '[data-anonymize="person-name"]' },
        { type: 'css', value: '[class*="mn-connection-card__name"]' },
        { type: 'css', value: '[class*="connection-card"] [class*="name"]' }
      ]
    },
    connectionHeadline: {
      strategies: [
        // Legacy (text patterns + DOM walk handle 2026 lite UI at the resolver level)
        { type: 'css', value: '.mn-connection-card__occupation' },
        { type: 'css', value: '[data-anonymize="headline"]' },
        { type: 'css', value: '[class*="mn-connection-card__occupation"]' },
        { type: 'css', value: '[class*="connection-card"] [class*="occupation"]' }
      ]
    },
    connectionLink: {
      strategies: [
        // 2026 lite UI: any /in/ anchor in the connections lazy column
        { type: 'css', value: '[data-testid="lazy-column"] a[href*="/in/"]' },
        { type: 'css', value: 'main a[href*="/in/"]' },
        // Legacy
        { type: 'css', value: '.mn-connection-card__link' },
        { type: 'css', value: 'a[href*="/in/"]' },
        { type: 'css', value: '[class*="mn-connection-card"] a[href*="/in/"]' }
      ]
    },
    connectionDate: {
      strategies: [
        // 2026 lite UI: text appears as "Connected on <date>" in a <p> — no <time> element
        // Legacy fallbacks first; resolver-level text matching handles the rest
        { type: 'css', value: '.mn-connection-card__connected-time' },
        { type: 'css', value: 'time' },
        { type: 'css', value: '[class*="mn-connection-card__connected"]' },
        { type: 'css', value: '[class*="connection-card"] time' }
      ]
    },
    nextPageButton: {
      strategies: [
        // 2026 lite UI: connections page uses infinite scroll — no Next button
        { type: 'cssWithText', value: 'main button', text: 'Next' },
        { type: 'css', value: 'button[aria-label="Next"]' },
        { type: 'css', value: '.artdeco-pagination__button--next' },
        { type: 'css', value: 'button[class*="pagination"][class*="next"]' },
        { type: 'cssWithText', value: 'button', text: 'next' }
      ],
      filters: ['visible', 'enabled', 'notDisabledClass']
    }
  },

  'linkedin.posts': {
    version: 2,
    // Commenter container — permalink post layout (differs from feed-stream cards)
    commenterContainer: {
      strategies: [
        // Modern LinkedIn (likely current)
        { type: 'css', value: 'article.comments-comments-list__comment-item' },
        { type: 'css', value: 'article[class*="comments-comment-item"]' },
        { type: 'css', value: 'div[class*="comments-comment-item"]' },
        { type: 'css', value: '[data-test-id*="comment-list-item"]' },
        // Broad catchall: any article inside a comments list
        { type: 'css', value: 'section[class*="comments"] article' },
        { type: 'css', value: '.comments-comments-list article' }
      ],
      filters: ['visible']
    },
    commenterName: {
      strategies: [
        { type: 'css', value: 'span.comments-post-meta__name-text' },
        { type: 'css', value: 'span[class*="comments-post-meta__name"]' },
        { type: 'css', value: 'h3[class*="comments-post-meta__name"]' },
        { type: 'css', value: '[data-test-id="comment-actor-name"]' },
        // Broad: any name-looking span inside a comments-post-meta
        { type: 'css', value: '[class*="comments-post-meta"] [class*="actor"]' },
        { type: 'css', value: '[class*="comments-post-meta"] a[href*="/in/"]' }
      ]
    },
    commenterProfileLink: {
      strategies: [
        { type: 'css', value: 'a.comments-post-meta__actor-link' },
        { type: 'css', value: 'a[class*="comments-post-meta"][href*="/in/"]' },
        { type: 'css', value: '[class*="comments-post-meta"] a[href*="/in/"]' },
        { type: 'css', value: 'a[href*="/in/"]' } // last resort: any /in/ link
      ]
    },
    loadMoreComments: {
      strategies: [
        { type: 'css', value: 'button.comments-comments-list__load-more-comments-button' },
        { type: 'css', value: 'button[class*="load-more-comments"]' },
        { type: 'cssWithText', value: 'button', text: 'load more comments' },
        { type: 'cssWithText', value: 'button', text: 'show more results' },
        { type: 'cssWithText', value: 'button', text: 'load previous replies' }
      ],
      filters: ['visible', 'enabled']
    }
  },

  'linkedin.feed': {
    version: 3,
    feedPost: {
      strategies: [
        // 2026 lite UI: each post is a [role="listitem"] inside the feed lazy column
        { type: 'css', value: 'main [data-testid="lazy-column"] [role="listitem"]' },
        { type: 'css', value: 'main [role="listitem"]' },
        // Legacy
        { type: 'css', value: '.feed-shared-update-v2' },
        { type: 'css', value: '[data-urn*="activity"]' },
        { type: 'css', value: '.occludable-update' },
        { type: 'css', value: '[class*="feed-shared-update"]' },
        { type: 'css', value: '[data-urn*="urn:li:activity"]' },
        { type: 'css', value: 'div[data-id*="urn:li:activity"]' }
      ]
    },
    postAuthor: {
      strategies: [
        // 2026 lite UI: author /in/ link inside the post; first <p> with author name follows
        { type: 'css', value: '[role="listitem"] a[href*="/in/"]' },
        { type: 'css', value: 'main a[href*="/in/"]' },
        // Legacy
        { type: 'css', value: '.feed-shared-actor__name span' },
        { type: 'css', value: '.update-components-actor__name span' },
        { type: 'css', value: '[class*="feed-shared-actor__name"] span' },
        { type: 'css', value: '[class*="update-components-actor__name"] span' },
        { type: 'css', value: '[class*="update-components-actor"] [aria-hidden="true"]' }
      ]
    },
    postText: {
      strategies: [
        // 2026 lite UI: post body is direct <p> inside the listitem
        { type: 'css', value: '[role="listitem"] p[dir="ltr"]' },
        { type: 'css', value: 'main [role="listitem"] p' },
        // Legacy
        { type: 'css', value: '.feed-shared-update-v2__description-wrapper span' },
        { type: 'css', value: '.feed-shared-text__text-view span' },
        { type: 'css', value: '.update-components-text span' },
        { type: 'css', value: '.feed-shared-text' },
        { type: 'css', value: '[class*="feed-shared-text"]' },
        { type: 'css', value: '[class*="update-components-text"] span[dir="ltr"]' }
      ]
    },
    postStats: {
      strategies: [
        // 2026 lite UI: reaction count appears as a [role="button"] with reaction aria
        { type: 'css', value: '[role="listitem"] [role="button"][aria-label*="reaction" i]' },
        { type: 'css', value: '[role="listitem"] button[aria-label*="reaction" i]' },
        // Legacy
        { type: 'css', value: '.social-details-social-counts' },
        { type: 'css', value: '.social-details-social-activity' },
        { type: 'css', value: '[class*="social-details-social-counts"]' },
        { type: 'css', value: '[class*="social-counts"]' },
        { type: 'css', value: 'span[aria-label*="reactions"]' },
        { type: 'css', value: 'button[aria-label*="reactions"]' }
      ]
    },
    likeButton: {
      strategies: [
        // 2026 lite UI: aria-label looks like "Reaction button state: no reaction" or "Reaction button state: thumbs up"
        { type: 'css', value: 'button[aria-label^="Reaction button state"]' },
        { type: 'css', value: 'button[aria-label*="Reaction button"]' },
        // Legacy
        { type: 'css', value: 'button[aria-label*="Like"]' },
        { type: 'css', value: 'button.react-button__trigger' },
        { type: 'css', value: 'button[aria-label*="like"]' },
        { type: 'css', value: '[class*="reactions-react-button"]' },
        { type: 'css', value: '[class*="reactions-react-button"] button' }
      ],
      filters: ['visible']
    },
    commentButton: {
      strategies: [
        // 2026 lite UI: aria-label is exactly "Comment" (no longer with post context)
        { type: 'css', value: 'button[aria-label="Comment"]' },
        { type: 'css', value: '[role="listitem"] button[aria-label^="Comment"]' },
        // Legacy
        { type: 'css', value: 'button[aria-label*="Comment"]' },
        { type: 'css', value: 'button[aria-label*="comment"]' },
        { type: 'css', value: '[class*="comment-button"]' },
        { type: 'css', value: '[class*="social-actions"] button[aria-label*="omment"]' }
      ],
      filters: ['visible']
    },
    commentInput: {
      strategies: [
        { type: 'css', value: '.comments-comment-box__form [contenteditable="true"]' },
        { type: 'css', value: '[role="textbox"].ql-editor' },
        { type: 'css', value: '.ql-editor[contenteditable="true"]' },
        { type: 'css', value: '[class*="comments-comment-box"] [contenteditable="true"]' },
        { type: 'css', value: 'div[contenteditable="true"][role="textbox"]' }
      ]
    },
    commentSubmit: {
      strategies: [
        { type: 'css', value: 'button.comments-comment-box__submit-button' },
        { type: 'textExact', value: 'button', text: 'Post' },
        { type: 'css', value: 'button[class*="comments-comment-box__submit"]' },
        { type: 'cssWithText', value: 'button', text: 'post' }
      ],
      filters: ['visible', 'enabled']
    },
    repostButton: {
      strategies: [
        // 2026 lite UI: aria-label is exactly "Repost"
        { type: 'css', value: 'button[aria-label="Repost"]' },
        { type: 'css', value: '[role="listitem"] button[aria-label^="Repost"]' },
        // Legacy
        { type: 'css', value: 'button[aria-label*="Repost"]' },
        { type: 'css', value: 'button[aria-label*="repost"]' },
        { type: 'css', value: '[class*="reshare"] button' },
        { type: 'css', value: '[class*="social-actions"] button[aria-label*="epost"]' }
      ],
      filters: ['visible']
    },
    repostNow: {
      strategies: [
        { type: 'textExact', value: 'button,span', text: 'Repost' },
        { type: 'css', value: '[data-control-name="repost"]' },
        { type: 'css', value: '[class*="reshare-options-menu"] [role="button"]' },
        { type: 'cssWithText', value: 'button,span', text: 'repost' }
      ]
    },
    // Post creation
    startPostButton: {
      strategies: [
        // 2026 lite UI: a div[role="button"] with text "Start a post"
        { type: 'cssWithText', value: 'main [role="button"]', text: 'Start a post' },
        { type: 'css', value: '.share-box-feed-entry__trigger' },
        // Legacy
        { type: 'textMatch', value: 'button', text: 'Start a post' },
        { type: 'css', value: '[class*="share-box-feed-entry__trigger"]' },
        { type: 'cssWithText', value: 'button', text: 'start a post' }
      ],
      filters: ['visible']
    },
    postComposer: {
      strategies: [
        { type: 'css', value: '.ql-editor[contenteditable="true"]' },
        { type: 'css', value: '[role="textbox"][contenteditable="true"]' },
        { type: 'css', value: 'div[contenteditable="true"][aria-label*="post"]' }
      ],
      scope: 'modal'
    },
    postSubmitButton: {
      strategies: [
        { type: 'css', value: 'button.share-actions__primary-action' },
        { type: 'textExact', value: 'button', text: 'Post' },
        { type: 'css', value: 'button[class*="share-actions__primary"]' },
        { type: 'cssWithText', value: 'button', text: 'post' }
      ],
      scope: 'modal',
      filters: ['visible', 'enabled']
    },
    // Post detail page (for engagement harvesting)
    commentItem: {
      strategies: [
        { type: 'css', value: '.comments-comment-item' },
        { type: 'css', value: '.comment-item' },
        { type: 'css', value: '[class*="comments-comment-item"]' },
        { type: 'css', value: 'article[class*="comments-comment-item"]' }
      ]
    },
    commentAuthorName: {
      strategies: [
        { type: 'css', value: '.comments-post-meta__name-text a span' },
        { type: 'css', value: '.comment-item__inline-show-more-text a span' },
        { type: 'css', value: '[class*="comments-post-meta__name"] a span' },
        { type: 'css', value: '[class*="comments-post-meta"] a[href*="/in/"] span' }
      ]
    },
    commentAuthorLink: {
      strategies: [
        { type: 'css', value: '.comments-post-meta__name-text a' },
        { type: 'css', value: 'a[data-control-name="comment_profile_link"]' },
        { type: 'css', value: '[class*="comments-post-meta"] a[href*="/in/"]' }
      ]
    },
    commentAuthorHeadline: {
      strategies: [
        { type: 'css', value: '.comments-post-meta__headline' },
        { type: 'css', value: '.comment-item__subtitle' },
        { type: 'css', value: '[class*="comments-post-meta__headline"]' }
      ]
    },
    showMoreComments: {
      strategies: [
        { type: 'textMatch', value: 'button', text: 'Load more comments' },
        { type: 'textMatch', value: 'button', text: 'more comment' },
        { type: 'css', value: 'button.comments-comments-list__load-more-comments-button' },
        { type: 'css', value: 'button[class*="load-more-comments"]' }
      ],
      filters: ['visible']
    }
  }
};
