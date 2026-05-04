/**
 * Default playbook definitions.
 * These define the built-in skills that ship with the extension.
 */

export const DEFAULT_PLAYBOOKS = {
  'accept-invites': {
    id: 'accept-invites',
    version: 2,
    name: 'Accept All Invitations',
    description: 'Bulk-accept pending LinkedIn connection invitations',
    urlPattern: 'linkedin\\.com/mynetwork/invitation-manager/',
    selectors: 'linkedin.invitations',
    buttonLabel: 'Accept All',
    settings: {
      delayMs: 500,
      securityCheckEnabled: true,
      securityCheckInterval: 5,
      scrollWaitMs: 2400,
      scrollRetries: 30
    },
    steps: [
      { action: 'setVar', var: 'processedCount', value: 0 },
      { action: 'setVar', var: 'skippedCount', value: 0 },
      { action: 'countElements', selector: 'invitationCard', fallbackKey: 'invitationCardByButtons', var: 'totalCount' },
      { action: 'updateProgress', processed: '$processedCount', total: '$totalCount' },
      {
        action: 'loop',
        breakIf: '$stopRequested',
        steps: [
          // Security check
          {
            action: 'conditional',
            condition: '$settings.securityCheckEnabled && $processedCount % $settings.securityCheckInterval === 0 && $processedCount > 0',
            onTrue: [{ action: 'checkSecurity' }]
          },
          { action: 'wait', ms: 100 },
          // Find accept buttons
          { action: 'findAll', selector: 'acceptButton', var: 'buttons' },
          {
            action: 'conditional',
            condition: '$buttons.length === 0',
            onTrue: [
              // No buttons — scroll to load more
              { action: 'scroll', direction: 'bottom' },
              { action: 'log', message: 'Loading more invitations...' },
              { action: 'waitForNew', selector: 'invitationCard', fallbackKey: 'invitationCardByButtons', maxAttempts: '$settings.scrollRetries', intervalMs: 300, var: 'foundMore' },
              {
                action: 'conditional',
                condition: '!$foundMore',
                onTrue: [{ action: 'break' }]
              }
            ],
            onFalse: [
              // Process each button
              {
                action: 'forEach',
                items: '$buttons',
                itemVar: 'btn',
                breakIf: '$stopRequested',
                steps: [
                  { action: 'click', element: '$btn' },
                  { action: 'incrementVar', var: 'processedCount' },
                  { action: 'updateProgress', processed: '$processedCount', total: '$totalCount' },
                  { action: 'log', message: 'Processing invitation...' },
                  { action: 'dismissModal' },
                  { action: 'wait', ms: '$settings.delayMs' }
                ]
              },
              // After processing, scroll and recount
              { action: 'scroll', direction: 'bottom' },
              { action: 'wait', ms: 1000 },
              { action: 'countElements', selector: 'invitationCard', fallbackKey: 'invitationCardByButtons', var: 'totalCount' }
            ]
          }
        ]
      }
    ]
  },

  'deny-invites': {
    id: 'deny-invites',
    version: 2,
    name: 'Deny All Invitations',
    description: 'Bulk-deny/ignore pending LinkedIn connection invitations',
    urlPattern: 'linkedin\\.com/mynetwork/invitation-manager/',
    selectors: 'linkedin.invitations',
    buttonLabel: 'Deny All',
    settings: {
      delayMs: 500,
      securityCheckEnabled: true,
      securityCheckInterval: 5,
      scrollWaitMs: 2400,
      scrollRetries: 30
    },
    steps: [
      { action: 'setVar', var: 'processedCount', value: 0 },
      { action: 'setVar', var: 'skippedCount', value: 0 },
      { action: 'countElements', selector: 'invitationCard', fallbackKey: 'invitationCardByButtons', var: 'totalCount' },
      { action: 'updateProgress', processed: '$processedCount', total: '$totalCount' },
      {
        action: 'loop',
        breakIf: '$stopRequested',
        steps: [
          {
            action: 'conditional',
            condition: '$settings.securityCheckEnabled && $processedCount % $settings.securityCheckInterval === 0 && $processedCount > 0',
            onTrue: [{ action: 'checkSecurity' }]
          },
          { action: 'wait', ms: 100 },
          { action: 'findAll', selector: 'ignoreButton', var: 'buttons' },
          {
            action: 'conditional',
            condition: '$buttons.length === 0',
            onTrue: [
              { action: 'scroll', direction: 'bottom' },
              { action: 'log', message: 'Loading more invitations...' },
              { action: 'waitForNew', selector: 'invitationCard', fallbackKey: 'invitationCardByButtons', maxAttempts: '$settings.scrollRetries', intervalMs: 300, var: 'foundMore' },
              {
                action: 'conditional',
                condition: '!$foundMore',
                onTrue: [{ action: 'break' }]
              }
            ],
            onFalse: [
              {
                action: 'forEach',
                items: '$buttons',
                itemVar: 'btn',
                breakIf: '$stopRequested',
                steps: [
                  { action: 'click', element: '$btn' },
                  { action: 'incrementVar', var: 'processedCount' },
                  { action: 'updateProgress', processed: '$processedCount', total: '$totalCount' },
                  { action: 'log', message: 'Processing invitation...' },
                  { action: 'dismissModal' },
                  { action: 'wait', ms: '$settings.delayMs' }
                ]
              },
              { action: 'scroll', direction: 'bottom' },
              { action: 'wait', ms: 1000 },
              { action: 'countElements', selector: 'invitationCard', fallbackKey: 'invitationCardByButtons', var: 'totalCount' }
            ]
          }
        ]
      }
    ]
  },

  'bulk-connect': {
    id: 'bulk-connect',
    version: 2,
    name: 'Connect All',
    description: 'Send connection requests to profiles in search results',
    urlPattern: 'linkedin\\.com/search/results/',
    selectors: 'linkedin.search',
    buttonLabel: null, // Dynamic — set at runtime with maxInvites
    settings: {
      maxItems: 50,
      delayMs: 1500,
      securityCheckEnabled: true,
      securityCheckInterval: 5
    },
    steps: [
      { action: 'setVar', var: 'processedCount', value: 0 },
      { action: 'setVar', var: 'skippedCount', value: 0 },
      { action: 'countElements', selector: 'searchResultCard', var: 'totalCount' },
      { action: 'updateProgress', processed: '$processedCount', total: '$settings.maxItems' },
      {
        action: 'loop',
        breakIf: '$stopRequested || $processedCount >= $settings.maxItems',
        steps: [
          // Security check
          {
            action: 'conditional',
            condition: '$settings.securityCheckEnabled && $processedCount % $settings.securityCheckInterval === 0 && $processedCount > 0',
            onTrue: [{ action: 'checkSecurity' }]
          },
          // Find connect buttons
          { action: 'findAll', selector: 'connectButton', var: 'buttons' },
          {
            action: 'conditional',
            condition: '$buttons.length === 0',
            onTrue: [
              // No buttons — scroll or paginate
              { action: 'scroll', direction: 'bottom' },
              { action: 'log', message: 'Loading more results...' },
              { action: 'waitForNew', selector: 'searchResultCard', maxAttempts: 10, intervalMs: 200, var: 'foundMore' },
              {
                action: 'conditional',
                condition: '!$foundMore',
                onTrue: [
                  // Try next page
                  { action: 'log', message: 'Trying next page...' },
                  { action: 'navigateNext', var: 'navigated' },
                  {
                    action: 'conditional',
                    condition: '!$navigated',
                    onTrue: [{ action: 'break' }],
                    onFalse: [
                      { action: 'wait', ms: 2500 },
                      { action: 'scroll', direction: 'top' },
                      { action: 'wait', ms: 500 },
                      { action: 'waitForElement', selector: 'connectButton', maxAttempts: 15, intervalMs: 500 }
                    ]
                  }
                ]
              }
            ],
            onFalse: [
              // Process each connect button
              {
                action: 'forEach',
                items: '$buttons',
                itemVar: 'btn',
                breakIf: '$stopRequested || $processedCount >= $settings.maxItems',
                steps: [
                  { action: 'click', element: '$btn' },
                  { action: 'wait', ms: 500 },
                  { action: 'handleInviteModal', var: 'sent' },
                  {
                    action: 'conditional',
                    condition: '$sent',
                    onTrue: [
                      { action: 'incrementVar', var: 'processedCount' },
                      { action: 'updateProgress', processed: '$processedCount', total: '$settings.maxItems' },
                      { action: 'log', message: 'Sent connection request' }
                    ],
                    onFalse: [
                      { action: 'incrementVar', var: 'skippedCount' },
                      { action: 'log', message: 'Skipped profile' }
                    ]
                  },
                  { action: 'wait', ms: '$settings.delayMs' }
                ]
              }
            ]
          }
        ]
      }
    ]
  },

  // --- AI-Powered Playbooks ---

  'ai-profile-review': {
    id: 'ai-profile-review',
    version: 2,
    name: 'AI Profile Review',
    description: 'AI analyzes your LinkedIn profile and suggests improvements',
    urlPattern: 'linkedin\\.com/in/',
    selectors: 'linkedin.profile',
    buttonLabel: 'Review My Profile',
    trustLevel: 'auto',
    settings: { requiresAI: true },
    steps: [
      { action: 'log', message: 'Extracting profile data...' },
      {
        action: 'extract',
        var: 'profile',
        selectors: {
          name: { selector: 'profileName', attribute: 'textContent' },
          headline: { selector: 'profileHeadline', attribute: 'textContent' },
          location: { selector: 'profileLocation', attribute: 'textContent' },
          about: { selector: 'profileAbout', attribute: 'textContent' },
          experience: { selector: 'profileExperience', attribute: 'textContent', multiple: true },
          education: { selector: 'profileEducation', attribute: 'textContent', multiple: true },
          skills: { selector: 'profileSkills', attribute: 'textContent', multiple: true },
          connectionCount: { selector: 'profileConnections', attribute: 'textContent' }
        }
      },
      { action: 'log', message: 'Analyzing with AI...' },
      {
        action: 'aiCall',
        var: 'review',
        aiType: 'profile_review',
        input: '$profile'
      },
      {
        action: 'storeData',
        collection: 'profileReviews',
        data: '$review'
      },
      {
        action: 'prompt',
        var: 'userAck',
        title: 'Profile Review',
        body: '$review',
        options: ['Got it', 'Done']
      }
    ]
  },

  'extract-contacts': {
    id: 'extract-contacts',
    version: 2,
    name: 'Extract Contacts',
    description: 'Scrape your recent LinkedIn connections into structured data',
    urlPattern: 'linkedin\\.com/mynetwork/invite-connect/connections/',
    selectors: 'linkedin.connections',
    buttonLabel: 'Extract Contacts',
    trustLevel: 'auto',
    settings: { maxPages: 5, delayMs: 1000 },
    steps: [
      { action: 'setVar', var: 'allContacts', value: [] },
      { action: 'setVar', var: 'pageNum', value: 0 },
      {
        action: 'loop',
        breakIf: '$stopRequested || $pageNum >= $settings.maxPages',
        steps: [
          { action: 'wait', ms: 1000 },
          { action: 'scroll', direction: 'bottom' },
          { action: 'wait', ms: 1500 },
          {
            action: 'extractAll',
            var: 'pageContacts',
            containerSelector: 'connectionCard',
            fields: {
              name: { childSelector: 'connectionName', attribute: 'textContent' },
              headline: { childSelector: 'connectionHeadline', attribute: 'textContent' },
              profileUrl: { childSelector: 'connectionLink', attribute: 'href' },
              connectedDate: { childSelector: 'connectionDate', attribute: 'textContent' }
            }
          },
          { action: 'appendArray', var: 'allContacts', items: '$pageContacts' },
          { action: 'incrementVar', var: 'pageNum' },
          { action: 'updateProgress', processed: '$pageNum', total: '$settings.maxPages' },
          { action: 'log', message: 'Extracting contacts...' },
          { action: 'navigateNext', var: 'hasMore' },
          {
            action: 'conditional',
            condition: '!$hasMore',
            onTrue: [{ action: 'break' }]
          },
          { action: 'wait', ms: '$settings.delayMs' }
        ]
      },
      {
        action: 'storeData',
        collection: 'contacts',
        data: '$allContacts',
        mergeKey: 'profileUrl'
      },
      { action: 'log', message: 'Extraction complete' }
    ]
  },

  'send-message': {
    id: 'send-message',
    version: 2,
    name: 'Send Message',
    description: 'Send an AI-personalized message to a profile you are viewing',
    urlPattern: 'linkedin\\.com/in/',
    selectors: 'linkedin.profile',
    buttonLabel: 'Send AI Message',
    trustLevel: 'review',
    settings: { requiresAI: true },
    steps: [
      { action: 'log', message: 'Reading profile...' },
      {
        action: 'extract',
        var: 'profile',
        selectors: {
          name: { selector: 'profileName', attribute: 'textContent' },
          headline: { selector: 'profileHeadline', attribute: 'textContent' }
        }
      },
      {
        action: 'aiCall',
        var: 'draft',
        aiType: 'connection_note',
        input: '$profile'
      },
      {
        action: 'prompt',
        var: 'approval',
        title: 'Message to $profile.name',
        body: '$draft',
        options: ['Send', 'Edit', 'Cancel']
      },
      {
        action: 'conditional',
        condition: "$approval === 'Send'",
        onTrue: [
          { action: 'find', selector: 'messageButton', var: 'msgBtn' },
          { action: 'click', element: '$msgBtn' },
          { action: 'wait', ms: 1000 },
          { action: 'typeText', selector: 'messageInput', text: '$draft.text', scope: 'modal' },
          { action: 'wait', ms: 500 },
          { action: 'find', selector: 'sendMessageButton', var: 'sendBtn', scope: 'modal' },
          { action: 'click', element: '$sendBtn' },
          { action: 'setVar', var: 'processedCount', value: 1 },
          { action: 'log', message: 'Message sent!' },
          {
            action: 'storeData',
            collection: 'outreach',
            data: [{ name: '$profile.name', headline: '$profile.headline', action: 'message_sent' }]
          }
        ]
      }
    ]
  },

  'search-extract': {
    id: 'search-extract',
    version: 2,
    name: 'Extract Lead List',
    description: 'Scrape profiles from search results into a lead list (no connecting)',
    urlPattern: 'linkedin\\.com/search/results/',
    selectors: 'linkedin.search-extract',
    buttonLabel: 'Extract Leads',
    trustLevel: 'auto',
    settings: { maxPages: 5, delayMs: 1500 },
    steps: [
      { action: 'setVar', var: 'allLeads', value: [] },
      { action: 'setVar', var: 'pageNum', value: 0 },
      { action: 'setVar', var: 'processedCount', value: 0 },
      {
        action: 'loop',
        breakIf: '$stopRequested || $pageNum >= $settings.maxPages',
        steps: [
          { action: 'wait', ms: 1000 },
          { action: 'scroll', direction: 'bottom' },
          { action: 'wait', ms: 1000 },
          {
            action: 'extractAll',
            var: 'pageLeads',
            containerSelector: 'searchResultCard',
            fields: {
              name: { childSelector: 'cardName', attribute: 'textContent' },
              headline: { childSelector: 'cardHeadline', attribute: 'textContent' },
              profileUrl: { childSelector: 'cardLink', attribute: 'href' },
              location: { childSelector: 'cardLocation', attribute: 'textContent' },
              snippet: { childSelector: 'cardSnippet', attribute: 'textContent' }
            }
          },
          { action: 'appendArray', var: 'allLeads', items: '$pageLeads' },
          { action: 'incrementVar', var: 'pageNum' },
          { action: 'setVar', var: 'processedCount', value: '$allLeads.length' },
          { action: 'updateProgress', processed: '$pageNum', total: '$settings.maxPages' },
          { action: 'log', message: 'Extracting leads...' },
          { action: 'navigateNext', var: 'hasMore' },
          {
            action: 'conditional',
            condition: '!$hasMore',
            onTrue: [{ action: 'break' }]
          },
          { action: 'wait', ms: '$settings.delayMs' }
        ]
      },
      {
        action: 'storeData',
        collection: 'contacts',
        data: '$allLeads',
        mergeKey: 'profileUrl'
      },
      { action: 'log', message: 'Extraction complete' }
    ]
  },

  'smart-outreach': {
    id: 'smart-outreach',
    version: 2,
    name: 'Smart Outreach Sequence',
    description: 'AI-personalized 3-step message sequence to your lead list',
    urlPattern: 'linkedin\\.com/',
    selectors: 'linkedin.messaging',
    buttonLabel: null,
    trustLevel: 'review',
    settings: { requiresAI: true },
    steps: [
      { action: 'log', message: 'This playbook creates a sequence from your contact list. Run Extract Leads first, then use the CLI or Schedule tab to manage sequences.' },
      {
        action: 'prompt',
        var: 'action',
        title: 'Smart Outreach',
        body: 'This creates an AI-powered 3-step outreach sequence:\n\n1. Personalized intro message (Day 0)\n2. Follow-up with value offer (Day 3)\n3. Final check-in (Day 7)\n\nContacts from your lead list will be enrolled. The AI personalizes each message based on their profile.',
        options: ['Create Sequence', 'Cancel']
      }
    ]
  },

  'warm-outreach': {
    id: 'warm-outreach',
    version: 2,
    name: 'Warm Outreach',
    description: 'View profile + like posts + connect with AI note for each lead',
    urlPattern: 'linkedin\\.com/',
    selectors: 'linkedin.profile',
    buttonLabel: null,
    trustLevel: 'review',
    settings: {
      requiresAI: true,
      delayMs: 3000,
      maxItems: 10,
      likesPerProfile: 2
    },
    steps: [
      { action: 'setVar', var: 'processedCount', value: 0 },
      { action: 'setVar', var: 'skippedCount', value: 0 },
      { action: 'log', message: 'Loading your lead list...' },
      // This playbook is driven by stored contacts — it iterates through them
      // The sequence: visit profile → scroll to see posts → like 1-2 → connect with note
      {
        action: 'prompt',
        var: 'confirm',
        title: 'Warm Outreach',
        body: 'This will visit each lead\'s profile, like their recent posts, and send a connection request with an AI-personalized note.\n\nMake sure you\'ve run "Extract Leads" first.',
        options: ['Start', 'Cancel']
      },
      {
        action: 'conditional',
        condition: "$confirm === 'Start'",
        onTrue: [
          { action: 'log', message: 'Starting warm outreach...' },
          // NOTE: This playbook is meant to be triggered from the sequence/CLI
          // which passes the contact list. When run standalone, it shows instructions.
          {
            action: 'prompt',
            var: 'done',
            title: 'How to use Warm Outreach',
            body: 'Use the CLI to run this on your lead list:\n\nfusenlink seq create "Warm Campaign"\nfusenlink seq enroll <id>\n\nOr run individual steps:\n1. Navigate to a profile\n2. Click "Run" on this playbook\n\nThe playbook will like posts and send a connect request.',
            options: ['Got it']
          }
        ]
      }
    ]
  },

  'warm-visit': {
    id: 'warm-visit',
    version: 2,
    name: 'Warm Visit',
    description: 'Like recent posts + connect with AI note on the current profile',
    urlPattern: 'linkedin\\.com/in/',
    selectors: 'linkedin.profile',
    buttonLabel: 'Warm Connect',
    trustLevel: 'review',
    settings: {
      requiresAI: true,
      delayMs: 2000,
      likesPerProfile: 2
    },
    steps: [
      { action: 'setVar', var: 'processedCount', value: 0 },

      // Step 1: Extract profile info
      { action: 'log', message: 'Reading profile...' },
      {
        action: 'extract',
        var: 'profile',
        selectors: {
          name: { selector: 'profileName', attribute: 'textContent' },
          headline: { selector: 'profileHeadline', attribute: 'textContent' }
        }
      },

      // Step 2: Scroll down to see posts, then like 1-2
      { action: 'log', message: 'Looking for recent posts...' },
      { action: 'scroll', direction: 'bottom' },
      { action: 'wait', ms: 1500 },
      { action: 'scroll', direction: 'bottom' },
      { action: 'wait', ms: 1000 },
      {
        action: 'findAll',
        selector: 'likeButton',
        var: 'likeButtons'
      },
      {
        action: 'conditional',
        condition: '$likeButtons.length > 0',
        onTrue: [
          { action: 'log', message: 'Liking a recent post...' },
          { action: 'click', element: '$likeButtons.0' },
          { action: 'wait', ms: '$settings.delayMs' },
          {
            action: 'conditional',
            condition: '$likeButtons.length > 1 && $settings.likesPerProfile > 1',
            onTrue: [
              { action: 'click', element: '$likeButtons.1' },
              { action: 'wait', ms: '$settings.delayMs' }
            ]
          }
        ],
        onFalse: [
          { action: 'log', message: 'No recent posts found, skipping likes' }
        ]
      },

      // Step 3: Scroll back to top and connect
      { action: 'scroll', direction: 'top' },
      { action: 'wait', ms: 1000 },

      // Step 4: AI draft connection note
      { action: 'log', message: 'Drafting connection note...' },
      {
        action: 'aiCall',
        var: 'note',
        aiType: 'connection_note',
        input: '$profile'
      },
      {
        action: 'prompt',
        var: 'approval',
        title: 'Connect with $profile.name?',
        body: '$note',
        options: ['Connect', 'Skip']
      },
      {
        action: 'conditional',
        condition: "$approval === 'Connect'",
        onTrue: [
          // Click Connect button
          { action: 'find', selector: 'connectButton', var: 'connectBtn' },
          {
            action: 'conditional',
            condition: '$connectBtn',
            onTrue: [
              { action: 'click', element: '$connectBtn' },
              { action: 'wait', ms: 800 },

              // Try to add a note
              { action: 'find', selector: 'addNoteButton', var: 'noteBtn', scope: 'modal' },
              {
                action: 'conditional',
                condition: '$noteBtn',
                onTrue: [
                  { action: 'click', element: '$noteBtn' },
                  { action: 'wait', ms: 500 },
                  { action: 'typeText', selector: 'noteTextarea', text: '$note.text', scope: 'modal' },
                  { action: 'wait', ms: 300 }
                ]
              },

              // Send
              { action: 'find', selector: 'sendConnectButton', var: 'sendBtn', scope: 'modal' },
              {
                action: 'conditional',
                condition: '$sendBtn',
                onTrue: [
                  { action: 'click', element: '$sendBtn' },
                  { action: 'setVar', var: 'processedCount', value: 1 },
                  { action: 'log', message: 'Connection request sent with note!' },
                  {
                    action: 'storeData',
                    collection: 'outreach',
                    data: [{ name: '$profile.name', headline: '$profile.headline', action: 'warm_connect' }]
                  }
                ],
                onFalse: [
                  { action: 'handleInviteModal', var: 'sent' },
                  {
                    action: 'conditional',
                    condition: '$sent',
                    onTrue: [
                      { action: 'setVar', var: 'processedCount', value: 1 },
                      { action: 'log', message: 'Connection request sent!' }
                    ]
                  }
                ]
              }
            ],
            onFalse: [
              { action: 'log', message: 'No Connect button found — may already be connected' },
              { action: 'incrementVar', var: 'skippedCount' }
            ]
          }
        ]
      }
    ]
  },

  'inbox-analysis': {
    id: 'inbox-analysis',
    version: 2,
    name: 'Analyze Inbox',
    description: 'AI classifies and prioritizes your LinkedIn inbox',
    urlPattern: 'linkedin\\.com/messaging/',
    selectors: 'linkedin.messaging',
    buttonLabel: 'Analyze Inbox',
    trustLevel: 'auto',
    settings: { requiresAI: true, maxConversations: 30 },
    steps: [
      { action: 'setVar', var: 'processedCount', value: 0 },
      { action: 'log', message: 'Scanning inbox...' },
      { action: 'scroll', direction: 'bottom' },
      { action: 'wait', ms: 1000 },
      { action: 'scroll', direction: 'bottom' },
      { action: 'wait', ms: 1000 },
      {
        action: 'extractAll',
        var: 'conversations',
        containerSelector: 'conversationItem',
        fields: {
          name: { childSelector: 'conversationName', attribute: 'textContent' },
          preview: { childSelector: 'conversationPreview', attribute: 'textContent' },
          timestamp: { childSelector: 'conversationTime', attribute: 'textContent' },
          unread: { childSelector: 'conversationUnread', attribute: 'exists' }
        }
      },
      { action: 'setVar', var: 'processedCount', value: '$conversations.length' },
      { action: 'log', message: 'Classifying conversations with AI...' },
      {
        action: 'aiCall',
        var: 'classification',
        aiType: 'classify_inbox',
        input: '$conversations'
      },
      {
        action: 'storeData',
        collection: 'inbox',
        data: '$classification'
      },
      {
        action: 'prompt',
        var: 'userAction',
        title: 'Inbox Analysis',
        body: '$classification',
        options: ['Done']
      }
    ]
  },

  // ==================== MARKETING PLAYBOOKS ====================

  'harvest-commenters': {
    id: 'harvest-commenters',
    version: 3,
    name: 'Harvest Post Commenters',
    description: 'Extract everyone who commented on a LinkedIn post into your lead list',
    urlPattern: 'linkedin\\.com/(feed/update|posts)/',
    selectors: 'linkedin.posts',
    buttonLabel: 'Extract Commenters',
    trustLevel: 'auto',
    settings: { maxComments: 100, delayMs: 500 },
    steps: [
      { action: 'setVar', var: 'allCommenters', value: [] },
      { action: 'setVar', var: 'processedCount', value: 0 },
      { action: 'log', message: 'Loading comments...' },

      // Expand all comments
      {
        action: 'loop',
        breakIf: '$stopRequested',
        steps: [
          { action: 'find', selector: 'showMoreComments', var: 'loadMore' },
          {
            action: 'conditional',
            condition: '!$loadMore',
            onTrue: [{ action: 'break' }]
          },
          { action: 'click', element: '$loadMore' },
          { action: 'wait', ms: 1000 }
        ]
      },

      // Extract all commenters
      { action: 'log', message: 'Extracting commenters...' },
      {
        action: 'extractAll',
        var: 'commenters',
        containerSelector: 'commentItem',
        fields: {
          name: { childSelector: 'commentAuthorName', attribute: 'textContent' },
          profileUrl: { childSelector: 'commentAuthorLink', attribute: 'href' },
          headline: { childSelector: 'commentAuthorHeadline', attribute: 'textContent' }
        }
      },
      { action: 'setVar', var: 'processedCount', value: '$commenters.length' },
      {
        action: 'storeData',
        collection: 'contacts',
        data: '$commenters',
        mergeKey: 'profileUrl'
      },
      { action: 'log', message: 'Commenters extracted to lead list!' }
    ]
  },

  'ai-draft-post': {
    id: 'ai-draft-post',
    version: 2,
    name: 'AI Draft Post',
    description: 'AI writes a LinkedIn post from your topic or prompt',
    urlPattern: 'linkedin\\.com/feed/',
    selectors: 'linkedin.feed',
    buttonLabel: 'Draft Post with AI',
    trustLevel: 'review',
    settings: { requiresAI: true },
    steps: [
      {
        action: 'prompt',
        var: 'topic',
        title: 'What should the post be about?',
        body: 'Enter a topic, insight, or prompt. AI will draft a LinkedIn-native post.\n\nExamples:\n- "Why we pivoted our pricing model"\n- "3 lessons from our first 100 customers"\n- "Hot take: most SaaS metrics are vanity metrics"',
        options: ['Draft It', 'Cancel']
      },
      {
        action: 'conditional',
        condition: "$topic === 'Cancel'",
        onTrue: [],
        onFalse: [
          { action: 'log', message: 'Drafting post...' },
          {
            action: 'aiCall',
            var: 'draft',
            aiType: 'draft_post',
            input: '$topic'
          },
          {
            action: 'prompt',
            var: 'action',
            title: 'Your AI-Drafted Post',
            body: '$draft',
            options: ['Post It', 'Copy to Clipboard', 'Regenerate', 'Cancel']
          },
          {
            action: 'conditional',
            condition: "$action === 'Post It'",
            onTrue: [
              { action: 'find', selector: 'startPostButton', var: 'startBtn' },
              { action: 'click', element: '$startBtn' },
              { action: 'wait', ms: 1000 },
              { action: 'typeText', selector: 'postComposer', text: '$draft.text', scope: 'modal' },
              { action: 'wait', ms: 500 },
              {
                action: 'prompt',
                var: 'confirmPost',
                title: 'Ready to publish?',
                body: 'The post is in the composer. Review it and click Publish, or edit first.',
                options: ['Publish Now', 'I\'ll Edit First']
              },
              {
                action: 'conditional',
                condition: "$confirmPost === 'Publish Now'",
                onTrue: [
                  { action: 'find', selector: 'postSubmitButton', var: 'postBtn', scope: 'modal' },
                  { action: 'click', element: '$postBtn' },
                  { action: 'setVar', var: 'processedCount', value: 1 },
                  { action: 'log', message: 'Post published!' },
                  {
                    action: 'storeData',
                    collection: 'outreach',
                    data: [{ action: 'post_published', details: '$topic' }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  },

  'ai-comment': {
    id: 'ai-comment',
    version: 2,
    name: 'AI Comment on Posts',
    description: 'AI writes substantive comments on posts in your feed',
    urlPattern: 'linkedin\\.com/feed/',
    selectors: 'linkedin.feed',
    buttonLabel: 'AI Engage Feed',
    trustLevel: 'review',
    settings: { requiresAI: true, maxPosts: 5, delayMs: 3000 },
    steps: [
      { action: 'setVar', var: 'processedCount', value: 0 },
      { action: 'setVar', var: 'skippedCount', value: 0 },
      { action: 'log', message: 'Scanning feed posts...' },

      { action: 'findAll', selector: 'feedPost', var: 'posts' },
      {
        action: 'forEach',
        items: '$posts',
        itemVar: 'post',
        breakIf: '$stopRequested || $processedCount >= $settings.maxPosts',
        steps: [
          // Extract post content
          {
            action: 'extract',
            var: 'postData',
            scopeElement: '$post',
            selectors: {
              author: { selector: 'postAuthor', attribute: 'textContent' },
              text: { selector: 'postText', attribute: 'textContent' }
            }
          },
          {
            action: 'conditional',
            condition: '$postData.text',
            onTrue: [
              // AI draft a comment
              {
                action: 'aiCall',
                var: 'comment',
                aiType: 'draft_comment',
                input: '$postData'
              },
              {
                action: 'prompt',
                var: 'approval',
                title: 'Comment on $postData.author\'s post?',
                body: '$comment',
                options: ['Comment', 'Skip']
              },
              {
                action: 'conditional',
                condition: "$approval === 'Comment'",
                onTrue: [
                  // Click comment button on this post
                  { action: 'find', selector: 'commentButton', var: 'cmtBtn', scopeElement: '$post' },
                  { action: 'click', element: '$cmtBtn' },
                  { action: 'wait', ms: 800 },
                  { action: 'typeText', selector: 'commentInput', text: '$comment.text' },
                  { action: 'wait', ms: 500 },
                  { action: 'find', selector: 'commentSubmit', var: 'submitBtn' },
                  { action: 'click', element: '$submitBtn' },
                  { action: 'incrementVar', var: 'processedCount' },
                  { action: 'log', message: 'Comment posted!' },
                  { action: 'wait', ms: '$settings.delayMs' }
                ],
                onFalse: [
                  { action: 'incrementVar', var: 'skippedCount' }
                ]
              }
            ]
          }
        ]
      }
    ]
  },

  'track-posts': {
    id: 'track-posts',
    version: 2,
    name: 'Track My Posts',
    description: 'Capture engagement stats from your recent LinkedIn posts',
    urlPattern: 'linkedin\\.com/in/',
    selectors: 'linkedin.profile',
    buttonLabel: 'Track Posts',
    trustLevel: 'auto',
    settings: {},
    steps: [
      { action: 'setVar', var: 'processedCount', value: 0 },
      { action: 'log', message: 'Scrolling to recent activity...' },
      { action: 'scroll', direction: 'bottom' },
      { action: 'wait', ms: 1500 },
      { action: 'scroll', direction: 'bottom' },
      { action: 'wait', ms: 1500 },
      {
        action: 'extractAll',
        var: 'posts',
        containerSelector: 'recentPost',
        fields: {
          text: { childSelector: 'postText', attribute: 'textContent' },
          stats: { childSelector: 'postStats', attribute: 'textContent' }
        }
      },
      { action: 'setVar', var: 'processedCount', value: '$posts.length' },
      {
        action: 'storeData',
        collection: 'outreach',
        data: [{ action: 'posts_tracked', posts: '$posts' }]
      },
      {
        action: 'prompt',
        var: 'done',
        title: 'Post Performance',
        body: '$posts',
        options: ['Done']
      }
    ]
  },

  // ==================== ACCELERATOR PLAYBOOKS ====================

  'cohort-engage': {
    id: 'cohort-engage',
    version: 2,
    name: 'Cohort Engagement Pod',
    description: 'Like + AI-comment on recent posts from your accelerator cohort',
    urlPattern: 'linkedin\\.com/',
    selectors: 'linkedin.profile',
    buttonLabel: null,
    trustLevel: 'review',
    settings: {
      requiresAI: true,
      delayMs: 3000,
      likesPerMember: 2
    },
    steps: [
      { action: 'setVar', var: 'processedCount', value: 0 },
      {
        action: 'prompt',
        var: 'confirm',
        title: 'Cohort Engagement Pod',
        body: 'This will visit each cohort member\'s profile, like their recent posts, and leave an AI-drafted comment.\n\nMake sure your cohort list is configured in Settings.\n\nThe algorithm rewards early engagement — run this within 30 min of cohort members posting.',
        options: ['Start', 'Cancel']
      },
      {
        action: 'conditional',
        condition: "$confirm === 'Start'",
        onTrue: [
          { action: 'log', message: 'Cohort engagement pod active. Configure cohort in Settings > Accelerator.' }
        ]
      }
    ]
  },

  'cohort-repost': {
    id: 'cohort-repost',
    version: 2,
    name: 'Mega-Post Repost',
    description: 'Repost a cohort member\'s top post to amplify their reach',
    urlPattern: 'linkedin\\.com/feed/',
    selectors: 'linkedin.feed',
    buttonLabel: 'Repost This',
    trustLevel: 'review',
    settings: {},
    steps: [
      // Find the first visible repost button
      { action: 'findAll', selector: 'feedPost', var: 'posts' },
      {
        action: 'conditional',
        condition: '$posts.length > 0',
        onTrue: [
          {
            action: 'extract',
            var: 'postInfo',
            scopeElement: '$posts.0',
            selectors: {
              author: { selector: 'postAuthor', attribute: 'textContent' },
              text: { selector: 'postText', attribute: 'textContent' }
            }
          },
          {
            action: 'prompt',
            var: 'confirm',
            title: 'Repost from $postInfo.author?',
            body: 'This will repost the top post in your feed to amplify a cohort member\'s reach.',
            options: ['Repost', 'Cancel']
          },
          {
            action: 'conditional',
            condition: "$confirm === 'Repost'",
            onTrue: [
              { action: 'find', selector: 'repostButton', var: 'repostBtn', scopeElement: '$posts.0' },
              { action: 'click', element: '$repostBtn' },
              { action: 'wait', ms: 500 },
              { action: 'find', selector: 'repostNow', var: 'repostNowBtn' },
              { action: 'click', element: '$repostNowBtn' },
              { action: 'setVar', var: 'processedCount', value: 1 },
              { action: 'log', message: 'Reposted!' },
              {
                action: 'storeData',
                collection: 'outreach',
                data: [{ action: 'cohort_repost', author: '$postInfo.author' }]
              }
            ]
          }
        ]
      }
    ]
  }
};
