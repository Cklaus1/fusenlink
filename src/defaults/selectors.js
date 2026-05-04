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
    version: 1,
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
    version: 1,
    searchResultCard: {
      strategies: [
        { type: 'css', value: '.reusable-search__result-container' },
        { type: 'css', value: '[class*="entity-result"]' }
      ]
    },
    connectButton: {
      strategies: [
        { type: 'textExact', value: 'button,a', text: 'Connect' },
        { type: 'ariaLabel', value: 'a', pattern: 'nvite.*onnect' }
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
        { type: 'css', value: 'button[aria-label="Next"]' },
        { type: 'css', value: '.artdeco-pagination__button--next' },
        { type: 'css', value: 'a[aria-label="Next"]' }
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
    version: 1,
    searchResultCard: {
      strategies: [
        { type: 'css', value: '.reusable-search__result-container' },
        { type: 'css', value: '[class*="entity-result"]' }
      ]
    },
    cardName: {
      strategies: [
        { type: 'css', value: '.entity-result__title-text a span[aria-hidden="true"]' },
        { type: 'css', value: '[data-anonymize="person-name"]' }
      ]
    },
    cardHeadline: {
      strategies: [
        { type: 'css', value: '.entity-result__primary-subtitle' },
        { type: 'css', value: '[data-anonymize="headline"]' }
      ]
    },
    cardLink: {
      strategies: [
        { type: 'css', value: '.entity-result__title-text a' },
        { type: 'css', value: 'a[href*="/in/"]' }
      ]
    },
    cardLocation: {
      strategies: [{ type: 'css', value: '.entity-result__secondary-subtitle' }]
    },
    cardSnippet: {
      strategies: [{ type: 'css', value: '.entity-result__summary' }]
    },
    nextPageButton: {
      strategies: [
        { type: 'css', value: 'button[aria-label="Next"]' },
        { type: 'css', value: '.artdeco-pagination__button--next' }
      ],
      filters: ['visible', 'enabled', 'notDisabledClass']
    }
  },

  'linkedin.profile': {
    version: 1,
    profileName: {
      strategies: [
        { type: 'css', value: '.text-heading-xlarge' },
        { type: 'css', value: 'h1[class*="text-heading"]' },
        { type: 'css', value: 'h1' }
      ]
    },
    profileHeadline: {
      strategies: [
        { type: 'css', value: '.text-body-medium[data-anonymize="headline"]' },
        { type: 'css', value: '[data-anonymize="headline"]' }
      ]
    },
    profileLocation: {
      strategies: [
        { type: 'css', value: '.text-body-small[data-anonymize="location"]' },
        { type: 'css', value: '[data-anonymize="location"]' }
      ]
    },
    profileAbout: {
      strategies: [
        { type: 'css', value: '#about ~ .display-flex .pv-shared-text-with-see-more span[aria-hidden="true"]' },
        { type: 'css', value: '[data-anonymize="person-summary-text"]' }
      ]
    },
    profileExperience: {
      strategies: [
        { type: 'css', value: '#experience ~ .pvs-list__outer-container li.artdeco-list__item' },
        { type: 'css', value: '.pv-experience-section__list-item' }
      ]
    },
    profileEducation: {
      strategies: [
        { type: 'css', value: '#education ~ .pvs-list__outer-container li.artdeco-list__item' }
      ]
    },
    profileSkills: {
      strategies: [
        { type: 'css', value: '#skills ~ .pvs-list__outer-container li.artdeco-list__item span[aria-hidden="true"]' }
      ]
    },
    profileConnections: {
      strategies: [
        { type: 'css', value: '.pv-top-card--list-bullet li span.t-bold' },
        { type: 'textMatch', value: 'span', text: 'connections' }
      ]
    },
    profileImage: {
      strategies: [
        { type: 'css', value: '.pv-top-card-profile-picture__image' },
        { type: 'css', value: 'img[data-anonymize="headshot-photo"]' }
      ]
    },
    mainContent: {
      strategies: [
        { type: 'css', value: 'main.scaffold-layout__main' },
        { type: 'css', value: 'main' }
      ]
    },
    messageButton: {
      strategies: [
        { type: 'textExact', value: 'button,a', text: 'Message' },
        { type: 'css', value: 'button[aria-label*="Message"]' }
      ],
      filters: ['visible', 'enabled']
    },
    connectButton: {
      strategies: [
        { type: 'textExact', value: 'button,a', text: 'Connect' },
        { type: 'css', value: 'button[aria-label*="connect"]' }
      ],
      filters: ['visible', 'enabled', 'notExtensionUI']
    },
    recentPost: {
      strategies: [
        { type: 'css', value: '.pv-recent-activity-section__feed-item' },
        { type: 'css', value: '[data-urn*="activity"]' },
        { type: 'css', value: '.feed-shared-update-v2' }
      ]
    },
    likeButton: {
      strategies: [
        { type: 'css', value: 'button[aria-label*="Like"]' },
        { type: 'css', value: 'button.react-button__trigger[aria-label*="like"]' }
      ],
      filters: ['visible', 'enabled']
    },
    addNoteButton: {
      strategies: [
        { type: 'textExact', value: 'button', text: 'Add a note' },
        { type: 'css', value: 'button[aria-label="Add a note"]' }
      ],
      scope: 'modal',
      filters: ['visible']
    },
    noteTextarea: {
      strategies: [
        { type: 'css', value: 'textarea[name="message"]' },
        { type: 'css', value: '#custom-message' }
      ],
      scope: 'modal'
    },
    sendConnectButton: {
      strategies: [
        { type: 'textExact', value: 'button', text: 'Send' },
        { type: 'css', value: 'button[aria-label="Send invitation"]' }
      ],
      scope: 'modal',
      filters: ['visible', 'enabled']
    }
  },

  'linkedin.messaging': {
    version: 1,
    conversationItem: {
      strategies: [
        { type: 'css', value: '.msg-conversation-listitem' },
        { type: 'css', value: '[class*="msg-conversation-listitem"]' }
      ]
    },
    conversationName: {
      strategies: [
        { type: 'css', value: '.msg-conversation-listitem__participant-names' },
        { type: 'css', value: 'h3.msg-conversation-listitem__title' }
      ]
    },
    conversationPreview: {
      strategies: [{ type: 'css', value: '.msg-conversation-listitem__message-snippet' }]
    },
    conversationTime: {
      strategies: [{ type: 'css', value: '.msg-conversation-listitem__time-stamp' }]
    },
    conversationUnread: {
      strategies: [{ type: 'css', value: '.msg-conversation-listitem__unread-count' }]
    },
    messageInput: {
      strategies: [
        { type: 'css', value: '.msg-form__contenteditable' },
        { type: 'css', value: '[role="textbox"][contenteditable="true"]' }
      ]
    },
    sendMessageButton: {
      strategies: [
        { type: 'css', value: '.msg-form__send-button' },
        { type: 'textExact', value: 'button', text: 'Send' }
      ],
      filters: ['visible', 'enabled']
    }
  },

  'linkedin.connections': {
    version: 1,
    connectionCard: {
      strategies: [
        { type: 'css', value: '.mn-connection-card' },
        { type: 'css', value: '.scaffold-finite-scroll__content li' }
      ]
    },
    connectionName: {
      strategies: [
        { type: 'css', value: '.mn-connection-card__name' },
        { type: 'css', value: '[data-anonymize="person-name"]' }
      ]
    },
    connectionHeadline: {
      strategies: [
        { type: 'css', value: '.mn-connection-card__occupation' },
        { type: 'css', value: '[data-anonymize="headline"]' }
      ]
    },
    connectionLink: {
      strategies: [
        { type: 'css', value: '.mn-connection-card__link' },
        { type: 'css', value: 'a[href*="/in/"]' }
      ]
    },
    connectionDate: {
      strategies: [
        { type: 'css', value: '.mn-connection-card__connected-time' },
        { type: 'css', value: 'time' }
      ]
    },
    nextPageButton: {
      strategies: [
        { type: 'css', value: 'button[aria-label="Next"]' },
        { type: 'css', value: '.artdeco-pagination__button--next' }
      ],
      filters: ['visible', 'enabled', 'notDisabledClass']
    }
  },

  'linkedin.feed': {
    version: 1,
    feedPost: {
      strategies: [
        { type: 'css', value: '.feed-shared-update-v2' },
        { type: 'css', value: '[data-urn*="activity"]' },
        { type: 'css', value: '.occludable-update' }
      ]
    },
    postAuthor: {
      strategies: [
        { type: 'css', value: '.feed-shared-actor__name span' },
        { type: 'css', value: '.update-components-actor__name span' }
      ]
    },
    postText: {
      strategies: [
        { type: 'css', value: '.feed-shared-update-v2__description-wrapper span' },
        { type: 'css', value: '.feed-shared-text__text-view span' },
        { type: 'css', value: '.update-components-text span' }
      ]
    },
    postStats: {
      strategies: [
        { type: 'css', value: '.social-details-social-counts' },
        { type: 'css', value: '.social-details-social-activity' }
      ]
    },
    likeButton: {
      strategies: [
        { type: 'css', value: 'button[aria-label*="Like"]' },
        { type: 'css', value: 'button.react-button__trigger' }
      ],
      filters: ['visible']
    },
    commentButton: {
      strategies: [
        { type: 'css', value: 'button[aria-label*="Comment"]' },
        { type: 'css', value: 'button[aria-label*="comment"]' }
      ],
      filters: ['visible']
    },
    commentInput: {
      strategies: [
        { type: 'css', value: '.comments-comment-box__form [contenteditable="true"]' },
        { type: 'css', value: '[role="textbox"].ql-editor' },
        { type: 'css', value: '.ql-editor[contenteditable="true"]' }
      ]
    },
    commentSubmit: {
      strategies: [
        { type: 'css', value: 'button.comments-comment-box__submit-button' },
        { type: 'textExact', value: 'button', text: 'Post' }
      ],
      filters: ['visible', 'enabled']
    },
    repostButton: {
      strategies: [
        { type: 'css', value: 'button[aria-label*="Repost"]' },
        { type: 'css', value: 'button[aria-label*="repost"]' }
      ],
      filters: ['visible']
    },
    repostNow: {
      strategies: [
        { type: 'textExact', value: 'button,span', text: 'Repost' },
        { type: 'css', value: '[data-control-name="repost"]' }
      ]
    },
    // Post creation
    startPostButton: {
      strategies: [
        { type: 'css', value: '.share-box-feed-entry__trigger' },
        { type: 'textMatch', value: 'button', text: 'Start a post' }
      ],
      filters: ['visible']
    },
    postComposer: {
      strategies: [
        { type: 'css', value: '.ql-editor[contenteditable="true"]' },
        { type: 'css', value: '[role="textbox"][contenteditable="true"]' }
      ],
      scope: 'modal'
    },
    postSubmitButton: {
      strategies: [
        { type: 'css', value: 'button.share-actions__primary-action' },
        { type: 'textExact', value: 'button', text: 'Post' }
      ],
      scope: 'modal',
      filters: ['visible', 'enabled']
    },
    // Post detail page (for engagement harvesting)
    commentItem: {
      strategies: [
        { type: 'css', value: '.comments-comment-item' },
        { type: 'css', value: '.comment-item' },
        { type: 'css', value: '[class*="comments-comment-item"]' }
      ]
    },
    commentAuthorName: {
      strategies: [
        { type: 'css', value: '.comments-post-meta__name-text a span' },
        { type: 'css', value: '.comment-item__inline-show-more-text a span' }
      ]
    },
    commentAuthorLink: {
      strategies: [
        { type: 'css', value: '.comments-post-meta__name-text a' },
        { type: 'css', value: 'a[data-control-name="comment_profile_link"]' }
      ]
    },
    commentAuthorHeadline: {
      strategies: [
        { type: 'css', value: '.comments-post-meta__headline' },
        { type: 'css', value: '.comment-item__subtitle' }
      ]
    },
    showMoreComments: {
      strategies: [
        { type: 'textMatch', value: 'button', text: 'Load more comments' },
        { type: 'textMatch', value: 'button', text: 'more comment' },
        { type: 'css', value: 'button.comments-comments-list__load-more-comments-button' }
      ],
      filters: ['visible']
    }
  }
};
