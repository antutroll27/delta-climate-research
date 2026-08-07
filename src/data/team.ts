// Single source of truth for the leadership roster rendered on /team.

export interface Member {
  id: string; // ordinal, '01'..
  first: string;
  last: string;
  tier: string; // role tier, e.g. 'Principal Consultant'
  discipline: string; // focus area
  mono: string; // initials 
  cover: 1 | 2 | 3 | 4; // gradient shown behind/while the photo loads
  photo: string; // /images/team/*.jpeg , real portrait
  photoPos: string; // object-position to frame the face in the circular disc
  bio: string[]; // detail-panel paragraphs
  focus: string[];
  background: string[];
  work: string[];
  email: string;
}

export const team: Member[] = [
  {
    id: '01', first: 'Angad', last: 'Burman', tier: 'Founder · Principal Consultant', discipline: 'Climate Analytics', mono: 'AB', cover: 1,
    photo: '/images/team/angad.jpeg', photoPos: '50% 45%',
    bio: [
      "Angad anchors his work in advanced climate policy and spatial analysis, having specialised in international climate governance at Columbia University and earth systems science at King's College London. With extensive global consulting experience scaling climate-technology solutions and hyper-local climate action, and refining corporate sustainability strategy, he is focused on hard climate science to build truly data-backed, resilient futures.",
      "As Founder and Principal Consultant, he scales global climate analytics by translating academic insight into actionable, large-scale climate action. Driven by rigorous data and technological objectives for climate modelling, Angad bridges deep-tech innovation and enterprise-level decarbonisation — using geospatial intelligence to turn environmental risk into high-impact institutional, technological and corporate solutions.",
    ],
    focus: ['Geospatial intelligence', 'Climate modelling', 'Decarbonisation strategy'],
    background: ['Climate governance — Columbia University', "Earth systems — King's College London"],
    work: ['Climate-technology scaling', 'Corporate sustainability strategy'],
    email: 'angad@deltaclimate.earth',
  },
  {
    id: '02', first: 'Shirsha', last: 'Sen', tier: 'Co-Founder · Principal Consultant', discipline: 'Climate Policy', mono: 'SS', cover: 2,
    photo: '/images/team/shirsha.jpeg', photoPos: '55% 22%',
    bio: [
      "Shirsha sits at the intersection of public policy, climate consulting, and multi-stakeholder ecosystem management. Combining an MA in Public Policy from OP Jindal Global University with focused experience at EY India and GIZ, she transforms complex environmental mandates into scalable institutional frameworks.",
      "As Principal Consultant for Climate Policy, Shirsha translates intricate field insights, supply-chain tracking, and regulatory requirements into targeted climate strategies. Her background building state-level green-budgeting methodologies and managing public-sector initiatives aligns environmental governance with measurable data outcomes — anchoring the team's analytics in compliance, cross-sector policy pathways, and systemic sustainable development.",
    ],
    focus: ['Climate policy', 'Regulatory frameworks', 'Green budgeting'],
    background: ['MA Public Policy — OP Jindal Global', 'EY India · GIZ'],
    work: ['State green budgeting', 'Public-sector climate programs'],
    email: 'shirsha@deltaclimate.earth',
  },
  {
    id: '03', first: 'Dhruv', last: 'Maniktala', tier: 'Lead', discipline: 'Operations Research', mono: 'DM', cover: 3,
    photo: '/images/team/dhruv.jpeg', photoPos: '50% 20%',
    bio: [
      'Dhruv sits at the intersection of deep financial markets, global banking expertise, and complex international supply chains. Combining a rigorous background in banking and quantitative finance with a firsthand understanding of large-scale regional logistics, he is uniquely positioned to turn environmental challenges into bankable, systemic infrastructure.',
      "As Lead for Operations Research, Dhruv anchors the team's sustainability initiatives in hard mathematics, translating complex environmental and commercial inputs into high-impact supply-chain solutions. Driven by quantitative risk analysis and resource optimisation, he leverages institutional capital and emerging technology to model low-carbon logistical pathways and scale the economic frameworks needed to rapidly decarbonise the global economy.",
    ],
    focus: ['Quantitative risk', 'Resource optimisation', 'Low-carbon logistics'],
    background: ['Banking & quantitative finance', 'Regional logistics operations'],
    work: ['Low-carbon logistics modelling', 'Climate-infrastructure finance'],
    email: 'dhruv@deltaclimate.earth',
  },
  {
    id: '04', first: 'Antariksha', last: 'Kumar', tier: 'Lead', discipline: 'Technology Implementation', mono: 'AK', cover: 4,
    photo: '/images/team/antariksha.jpeg', photoPos: '50% 42%',
    bio: [
      'Antariksha sits at the intersection of frontend engineering, human-computer interaction, and frontier AI-assisted development. Holding an MSc in HCI from the University of Nottingham and a BTech in Computer Science, he builds high-velocity infrastructure for complex digital applications.',
      "As Lead for Technology Implementation, Antariksha eliminates friction between backend data models and end-user execution. Experienced in deploying SaaS applications, running real-time data pipelines, and engineering agentic workflows with Claude Code, he drives the team's analytics-visualisation goals — translating intricate cross-platform data models into high-performance, intuitive dashboards that scale real-world impact.",
    ],
    focus: ['Platform engineering', 'Data visualisation', 'Agentic workflows'],
    background: ['MSc Human-Computer Interaction — Nottingham', 'BTech Computer Science'],
    work: ['Real-time data pipelines', 'Analytics dashboards'],
    email: 'ant@deltaclimate.earth',
  },
  {
    id: '05', first: 'Roshni', last: 'Rakshit', tier: 'Lead', discipline: 'Communications', mono: 'RR', cover: 2,
    photo: '/images/team/roshni.jpeg', photoPos: '50% 32%',
    bio: [
      "Roshni shapes how the world interacts with the team's environmental innovations, backed by a Bachelor's degree in Communication from Simon Fraser University in Vancouver, Canada. Her core capabilities lie in translating dense scientific concepts into powerful public narratives, conducting deep interviews with climate and technical experts, and orchestrating comprehensive, data-driven awareness campaigns.",
      "Anchored in a range of international experience — including leading cross-functional corporate communications and coordinating complex multi-channel marketing launches — Roshni distils Delta's scientific and technical insight into accessible corporate narratives, scaling the organisation's brand voice to engage the global conversation on climate action.",
    ],
    focus: ['Science storytelling', 'Media & PR', 'Brand campaigns'],
    background: ['BA Communication — Simon Fraser University'],
    work: ['Cross-functional comms', 'Multi-channel campaigns'],
    email: 'roshni@deltaclimate.earth',
  },
];
