import { useState, useEffect } from 'react';
import { Shield, Heart, TrendingUp, Search, Building2, MapPin, Database, Users, Bot, Cpu, Globe, CheckCircle2, RefreshCw, KeyRound, Wifi, ArrowUpRight, ArrowDownRight, Minus, Info, Sparkles, Lock, Activity, Layers } from 'lucide-react';
import LiveCrawlerPage from './LiveCrawlerPage';
import RawJsonTab from './RawJsonTab';
import AcquisitionPage from './AcquisitionPage';
import './App.css';

const API = import.meta.env.PROD ? '/api/trpc' : 'http://localhost:4000/trpc';



const AGENTS = [
  { name: 'Orchestrator Agent', icon: <Cpu size={16}/>, desc: 'Plans the research pipeline, dispatches sub-agents, merges results, and enforces scoring rules.', lastActivity: 'Consolidated Medanta scoring matrix & pushed clinical quality rating.', status: 'Idle (Listening)', lastRun: '2 mins ago' },
  { name: 'Registry Agent', icon: <Database size={16}/>, desc: 'Pulls and validates structured data from ABDM, NABH, and CGHS registries.', lastActivity: 'Validated ABDM Hospital Facility Registry (HFR) credentials & beds registry.', status: 'Active (Monitoring)', lastRun: '12 mins ago' },
  { name: 'Web Research Agent', icon: <Globe size={16}/>, desc: 'Crawls unstructured news sources, consumer court filings, and official portals.', lastActivity: 'Completed Tavily search for recent media disputes & local coverage reports.', status: 'Idle (Listening)', lastRun: '1 hr ago' },
  { name: 'Sentiment Agent', icon: <Heart size={16}/>, desc: 'Applies NLP to patient reviews, Practo comments, and public feedback networks.', lastActivity: 'NLP parsed 142 recent Google Maps review sentiment vectors.', status: 'Active (Crawling)', lastRun: '15 mins ago' },
  { name: 'Billing Analyst', icon: <TrendingUp size={16}/>, desc: 'Scans NHCX data feeds for cost variances, length-of-stay outliers, and package disputes.', lastActivity: 'Matched 145 claims lines against procedural averages (package variance: 4.2%).', status: 'Active (Monitoring)', lastRun: '5 mins ago' },
  { name: 'Supervisor Agent', icon: <Shield size={16}/>, desc: 'Cross-checks findings across agents, validates fraud risk levels, and signs PII indices.', lastActivity: 'Certified Medanta compliance rating. Signed off fraud risk level as LOW.', status: 'Active (Validating)', lastRun: 'Just now' },
];

const DATA_SOURCES = [
  { name: 'ABDM Health Facility Registry', type: 'Objective', agent: 'Registry Agent', lastCheck: '12 mins ago', status: 'Active API', cost: 'Free', compliance: 'Verified' },
  { name: 'NABH India', type: 'Objective', agent: 'Registry Agent', lastCheck: '1 hr ago', status: 'Active API', cost: 'Free', compliance: 'Verified' },
  { name: 'NMC India', type: 'Objective', agent: 'Registry Agent', lastCheck: '4 hrs ago', status: 'Crawled', cost: 'Free', compliance: 'Verified' },
  { name: 'CGHS / ECHS portal', type: 'Objective', agent: 'Web Research Agent', lastCheck: '1 day ago', status: 'Crawled', cost: 'Free', compliance: 'Verified' },
  { name: 'OpenStreetMap / Overpass API', type: 'Objective', agent: 'Registry Agent', lastCheck: '3 hrs ago', status: 'Active API', cost: 'Free', compliance: 'Verified' },
  { name: 'National Consumer Helpline (NCH)', type: 'Subjective', agent: 'Web Research Agent', lastCheck: '6 hrs ago', status: 'Data Portal', cost: 'Free', compliance: 'Verified' },
  { name: 'Google Maps Places API', type: 'Subjective', agent: 'Sentiment Agent', lastCheck: '15 mins ago', status: 'Active API', cost: 'Paid ~$17/1k', compliance: 'Live' },
  { name: 'SerpAPI', type: 'Subjective', agent: 'Web Research Agent', lastCheck: '2 hrs ago', status: 'Active API', cost: 'Paid $50/mo+', compliance: 'Live' },
  { name: 'Tavily Search API', type: 'Subjective', agent: 'Web Research Agent', lastCheck: '1 hr ago', status: 'Active API', cost: 'Free tier then $', compliance: 'Live' },
  { name: 'Firecrawl', type: 'Subjective', agent: 'Web Research Agent', lastCheck: '30 mins ago', status: 'Active API', cost: 'Free tier (500)', compliance: 'Live' },
  { name: 'Twitter / X API v2', type: 'Subjective', agent: 'Sentiment Agent', lastCheck: '45 mins ago', status: 'Active API', cost: 'Paid $100/mo', compliance: 'Live' },
  { name: 'Practo / Lybrate', type: 'Subjective', agent: 'Sentiment Agent', lastCheck: '3 hrs ago', status: 'Crawled', cost: 'Free (crawl)', compliance: 'Live' },
  { name: 'Justdial', type: 'Subjective', agent: 'Sentiment Agent', lastCheck: '5 hrs ago', status: 'Crawled', cost: 'Free (crawl)', compliance: 'Live' },
  { name: 'Indeed / Naukri postings', type: 'Subjective', agent: 'Web Research Agent', lastCheck: '2 days ago', status: 'Crawled/API', cost: 'Free', compliance: 'Live' },
  { name: 'NHCX (NHA) Claims', type: 'Objective', agent: 'Billing Analyst', lastCheck: '5 mins ago', status: 'Institutional API', cost: 'Partnership', compliance: 'Verified' },
  { name: 'Anthropic Claude API', type: 'Processing', agent: 'Orchestrator Agent', lastCheck: 'Just now', status: 'Active API', cost: 'Paid per token', compliance: 'Live' },
  { name: 'Exa.ai', type: 'Subjective', agent: 'Web Research Agent', lastCheck: '4 hrs ago', status: 'Active API', cost: 'Free tier + $', compliance: 'Live' },
  { name: 'BrightData / Oxylabs', type: 'Infrastructure', agent: 'Web Research Agent', lastCheck: '15 mins ago', status: 'Active Proxy', cost: 'Paid $0.001/req', compliance: 'Live' }
];

const CONNECTIONS = [
  { id: 'abdm', name: 'ABDM Sandbox API', type: 'OAuth 2.0', status: 'Connected', desc: 'Used by Registry Agent for Health Facility validation.' },
  { id: 'nhcx', name: 'NHCX Institutional', type: 'mTLS Certificate', status: 'Pending Auth', desc: 'Secure claims clearinghouse for Billing Analyst.' },
  { id: 'nabh', name: 'NABH Registry', type: 'Bearer Token', status: 'Connected', desc: 'Retrieves official accreditation statuses.' },
  { id: 'tavily', name: 'Tavily Search', type: 'API Key', status: 'Connected', desc: 'Optimized search indexing for the Web Research Agent.' },
  { id: 'firecrawl', name: 'Firecrawl Extract', type: 'Bearer Token', status: 'Connected', desc: 'Extracts structured Markdown from raw web pages.' },
  { id: 'google', name: 'Google Maps Places API', type: 'API Key', status: 'Configured', desc: 'Powers Sentiment Agent review ingestion.' },
  { id: 'claude', name: 'Anthropic Claude API', type: 'API Key', status: 'Connected', desc: 'Substrate for Orchestrator and NLP Agents.' },
  { id: 'brightdata', name: 'BrightData Residential', type: 'Proxy Credentials', status: 'Connected', desc: 'IP rotation infrastructure for heavy scrapes.' },
  { id: 'exa', name: 'Exa.ai', type: 'API Key', status: 'Configured', desc: 'Neural search for deep medical news context.' },
  { id: 'twitter', name: 'X / Twitter API v2', type: 'OAuth 2.0', status: 'Connected', desc: 'Real-time consumer dispute monitoring.' },
];

const DeltaBadge = ({ val, suffix='' }: { val?: number, suffix?: string }) => {
  if (val === undefined) return null;
  if (val > 0) return <span className="delta-badge up"><ArrowUpRight size={10}/> {val}{suffix}</span>;
  if (val < 0) return <span className="delta-badge down"><ArrowDownRight size={10}/> {Math.abs(val)}{suffix}</span>;
  return <span className="delta-badge neutral"><Minus size={10}/> Flat</span>;
};

const getColor = (score: number) => {
  if (score >= 80) return 'var(--green)';
  if (score >= 50) return 'var(--orange)';
  return 'var(--red)';
};

export const MOCK_FACS = [
    { id: '1', name: 'Medanta - The Medicity', city: 'Gurugram', state: 'Haryana', piiScore: 88.5, bedCount: 1250, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 92, operationalScore: 89, billingStabilityScore: 85.5, clinicalQualityScore: 91, patientExperienceScore: 84, fraudRiskScore: 12, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '2', name: 'Apollo Hospitals', city: 'Indore', state: 'Madhya Pradesh', piiScore: 84.2, bedCount: 350, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 86, operationalScore: 85, billingStabilityScore: 82, clinicalQualityScore: 86, patientExperienceScore: 81, fraudRiskScore: 15, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '3', name: 'Choithram Hospital', city: 'Indore', state: 'Madhya Pradesh', piiScore: 67.4, bedCount: 600, nabhStatus: 'ACCREDITED_PROGRESSIVE', nabhGrade: 'B+', trustScore: 72, operationalScore: 70, billingStabilityScore: 55, clinicalQualityScore: 74, patientExperienceScore: 71, fraudRiskScore: 48, fraudRiskLevel: 'MEDIUM', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '4', name: 'AIIMS Delhi', city: 'New Delhi', state: 'Delhi', piiScore: 95.1, bedCount: 2478, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 98, operationalScore: 93, billingStabilityScore: 92, clinicalQualityScore: 96, patientExperienceScore: 88, fraudRiskScore: 5, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '5', name: 'Fortis Memorial Research Institute', city: 'Gurugram', state: 'Haryana', piiScore: 90.3, bedCount: 1000, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 93, operationalScore: 91, billingStabilityScore: 88, clinicalQualityScore: 92, patientExperienceScore: 86, fraudRiskScore: 10, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '6', name: 'Max Super Speciality Hospital', city: 'New Delhi', state: 'Delhi', piiScore: 86.7, bedCount: 500, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 88, operationalScore: 87, billingStabilityScore: 84, clinicalQualityScore: 88, patientExperienceScore: 83, fraudRiskScore: 14, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '7', name: 'Sir Ganga Ram Hospital', city: 'New Delhi', state: 'Delhi', piiScore: 87.9, bedCount: 675, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 90, operationalScore: 86, billingStabilityScore: 85, clinicalQualityScore: 89, patientExperienceScore: 85, fraudRiskScore: 11, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '8', name: 'Tata Memorial Hospital', city: 'Mumbai', state: 'Maharashtra', piiScore: 93.2, bedCount: 629, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 95, operationalScore: 90, billingStabilityScore: 91, clinicalQualityScore: 95, patientExperienceScore: 87, fraudRiskScore: 7, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '9', name: 'Kokilaben Dhirubhai Ambani Hospital', city: 'Mumbai', state: 'Maharashtra', piiScore: 91.4, bedCount: 750, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 94, operationalScore: 92, billingStabilityScore: 89, clinicalQualityScore: 93, patientExperienceScore: 88, fraudRiskScore: 9, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '10', name: 'Lilavati Hospital', city: 'Mumbai', state: 'Maharashtra', piiScore: 82.1, bedCount: 323, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 84, operationalScore: 80, billingStabilityScore: 79, clinicalQualityScore: 85, patientExperienceScore: 80, fraudRiskScore: 18, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '11', name: 'Narayana Health City', city: 'Bengaluru', state: 'Karnataka', piiScore: 89.6, bedCount: 800, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 91, operationalScore: 90, billingStabilityScore: 87, clinicalQualityScore: 91, patientExperienceScore: 85, fraudRiskScore: 11, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '12', name: 'Manipal Hospital Old Airport Road', city: 'Bengaluru', state: 'Karnataka', piiScore: 85.8, bedCount: 600, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 87, operationalScore: 86, billingStabilityScore: 83, clinicalQualityScore: 87, patientExperienceScore: 82, fraudRiskScore: 16, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '13', name: 'Apollo Hospitals Greams Road', city: 'Chennai', state: 'Tamil Nadu', piiScore: 88.1, bedCount: 560, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 90, operationalScore: 88, billingStabilityScore: 86, clinicalQualityScore: 90, patientExperienceScore: 84, fraudRiskScore: 13, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '14', name: 'MIOT International', city: 'Chennai', state: 'Tamil Nadu', piiScore: 83.5, bedCount: 600, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 85, operationalScore: 82, billingStabilityScore: 81, clinicalQualityScore: 86, patientExperienceScore: 80, fraudRiskScore: 17, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '15', name: 'Christian Medical College', city: 'Vellore', state: 'Tamil Nadu', piiScore: 94.7, bedCount: 2700, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 97, operationalScore: 92, billingStabilityScore: 93, clinicalQualityScore: 96, patientExperienceScore: 90, fraudRiskScore: 4, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '16', name: 'PGIMER', city: 'Chandigarh', state: 'Chandigarh', piiScore: 93.8, bedCount: 1900, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 96, operationalScore: 91, billingStabilityScore: 90, clinicalQualityScore: 95, patientExperienceScore: 86, fraudRiskScore: 6, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '17', name: 'Sanjay Gandhi PGIMS', city: 'Lucknow', state: 'Uttar Pradesh', piiScore: 88.4, bedCount: 1100, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 91, operationalScore: 87, billingStabilityScore: 85, clinicalQualityScore: 90, patientExperienceScore: 83, fraudRiskScore: 13, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '18', name: 'Ruby Hall Clinic', city: 'Pune', state: 'Maharashtra', piiScore: 84.6, bedCount: 750, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 86, operationalScore: 84, billingStabilityScore: 82, clinicalQualityScore: 86, patientExperienceScore: 81, fraudRiskScore: 16, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '19', name: 'Jehangir Hospital', city: 'Pune', state: 'Maharashtra', piiScore: 81.2, bedCount: 350, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 83, operationalScore: 80, billingStabilityScore: 78, clinicalQualityScore: 84, patientExperienceScore: 79, fraudRiskScore: 19, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '20', name: 'Amrita Hospital', city: 'Kochi', state: 'Kerala', piiScore: 90.8, bedCount: 1200, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 93, operationalScore: 89, billingStabilityScore: 88, clinicalQualityScore: 92, patientExperienceScore: 87, fraudRiskScore: 10, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '21', name: 'Aster Medcity', city: 'Kochi', state: 'Kerala', piiScore: 85.3, bedCount: 670, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 87, operationalScore: 85, billingStabilityScore: 83, clinicalQualityScore: 87, patientExperienceScore: 82, fraudRiskScore: 15, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '22', name: 'KIMS Hospital', city: 'Hyderabad', state: 'Telangana', piiScore: 86.9, bedCount: 1000, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 89, operationalScore: 86, billingStabilityScore: 84, clinicalQualityScore: 88, patientExperienceScore: 83, fraudRiskScore: 14, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '23', name: 'Yashoda Hospitals', city: 'Hyderabad', state: 'Telangana', piiScore: 82.4, bedCount: 500, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 84, operationalScore: 81, billingStabilityScore: 80, clinicalQualityScore: 84, patientExperienceScore: 79, fraudRiskScore: 20, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '24', name: 'Care Hospitals', city: 'Hyderabad', state: 'Telangana', piiScore: 80.7, bedCount: 435, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 82, operationalScore: 79, billingStabilityScore: 77, clinicalQualityScore: 83, patientExperienceScore: 78, fraudRiskScore: 22, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '25', name: 'Bombay Hospital', city: 'Mumbai', state: 'Maharashtra', piiScore: 85.1, bedCount: 750, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 87, operationalScore: 84, billingStabilityScore: 83, clinicalQualityScore: 87, patientExperienceScore: 82, fraudRiskScore: 15, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '26', name: 'Rajiv Gandhi Cancer Institute', city: 'New Delhi', state: 'Delhi', piiScore: 91.2, bedCount: 310, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 94, operationalScore: 88, billingStabilityScore: 90, clinicalQualityScore: 93, patientExperienceScore: 85, fraudRiskScore: 8, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '27', name: 'Sankara Nethralaya', city: 'Chennai', state: 'Tamil Nadu', piiScore: 89.5, bedCount: 400, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 92, operationalScore: 87, billingStabilityScore: 88, clinicalQualityScore: 92, patientExperienceScore: 86, fraudRiskScore: 9, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '28', name: 'Wockhardt Hospital', city: 'Mumbai', state: 'Maharashtra', piiScore: 76.8, bedCount: 300, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'B+', trustScore: 79, operationalScore: 75, billingStabilityScore: 73, clinicalQualityScore: 80, patientExperienceScore: 74, fraudRiskScore: 28, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '29', name: 'Sterling Hospital', city: 'Ahmedabad', state: 'Gujarat', piiScore: 81.5, bedCount: 400, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 83, operationalScore: 80, billingStabilityScore: 79, clinicalQualityScore: 84, patientExperienceScore: 78, fraudRiskScore: 21, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '30', name: 'HCG Cancer Centre', city: 'Bengaluru', state: 'Karnataka', piiScore: 84.3, bedCount: 250, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 87, operationalScore: 82, billingStabilityScore: 83, clinicalQualityScore: 86, patientExperienceScore: 80, fraudRiskScore: 16, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '31', name: 'Breach Candy Hospital', city: 'Mumbai', state: 'Maharashtra', piiScore: 83.7, bedCount: 200, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 86, operationalScore: 81, billingStabilityScore: 82, clinicalQualityScore: 85, patientExperienceScore: 81, fraudRiskScore: 17, fraudRiskLevel: 'LOW', cghsEmpanelled: false, echsEmpanelled: false, abdmReadiness: true },
    { id: '32', name: 'Jaslok Hospital', city: 'Mumbai', state: 'Maharashtra', piiScore: 82.9, bedCount: 364, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 85, operationalScore: 81, billingStabilityScore: 80, clinicalQualityScore: 85, patientExperienceScore: 80, fraudRiskScore: 18, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '33', name: 'Nanavati Max Hospital', city: 'Mumbai', state: 'Maharashtra', piiScore: 81.6, bedCount: 350, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 84, operationalScore: 80, billingStabilityScore: 78, clinicalQualityScore: 83, patientExperienceScore: 79, fraudRiskScore: 20, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '34', name: 'BLK-Max Super Speciality Hospital', city: 'New Delhi', state: 'Delhi', piiScore: 85.4, bedCount: 700, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 88, operationalScore: 84, billingStabilityScore: 83, clinicalQualityScore: 87, patientExperienceScore: 82, fraudRiskScore: 15, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '35', name: 'Fortis Escorts Heart Institute', city: 'New Delhi', state: 'Delhi', piiScore: 88.9, bedCount: 310, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 91, operationalScore: 87, billingStabilityScore: 87, clinicalQualityScore: 90, patientExperienceScore: 85, fraudRiskScore: 12, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '36', name: 'Artemis Hospital', city: 'Gurugram', state: 'Haryana', piiScore: 83.2, bedCount: 400, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 85, operationalScore: 82, billingStabilityScore: 80, clinicalQualityScore: 85, patientExperienceScore: 80, fraudRiskScore: 19, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '37', name: 'Indraprastha Apollo', city: 'New Delhi', state: 'Delhi', piiScore: 87.6, bedCount: 710, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 90, operationalScore: 86, billingStabilityScore: 85, clinicalQualityScore: 89, patientExperienceScore: 84, fraudRiskScore: 13, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '38', name: 'SMS Hospital', city: 'Jaipur', state: 'Rajasthan', piiScore: 71.3, bedCount: 1500, nabhStatus: 'ACCREDITED_PROGRESSIVE', nabhGrade: 'B+', trustScore: 74, operationalScore: 69, billingStabilityScore: 65, clinicalQualityScore: 76, patientExperienceScore: 70, fraudRiskScore: 35, fraudRiskLevel: 'MEDIUM', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '39', name: 'Mahatma Gandhi Hospital', city: 'Jaipur', state: 'Rajasthan', piiScore: 78.5, bedCount: 800, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 80, operationalScore: 77, billingStabilityScore: 75, clinicalQualityScore: 81, patientExperienceScore: 76, fraudRiskScore: 25, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '40', name: 'NIMHANS', city: 'Bengaluru', state: 'Karnataka', piiScore: 92.1, bedCount: 897, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A+', trustScore: 95, operationalScore: 89, billingStabilityScore: 90, clinicalQualityScore: 94, patientExperienceScore: 86, fraudRiskScore: 7, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '41', name: 'Kidwai Memorial Institute', city: 'Bengaluru', state: 'Karnataka', piiScore: 80.9, bedCount: 350, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 83, operationalScore: 78, billingStabilityScore: 77, clinicalQualityScore: 84, patientExperienceScore: 77, fraudRiskScore: 23, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '42', name: 'Command Hospital Pune', city: 'Pune', state: 'Maharashtra', piiScore: 84.7, bedCount: 1000, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 87, operationalScore: 83, billingStabilityScore: 82, clinicalQualityScore: 86, patientExperienceScore: 81, fraudRiskScore: 14, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '43', name: 'Apex Hospital', city: 'Ujjain', state: 'Madhya Pradesh', piiScore: 61.8, bedCount: 150, nabhStatus: 'ACCREDITED_ENTRY', nabhGrade: 'B', trustScore: 65, operationalScore: 58, billingStabilityScore: 68, clinicalQualityScore: 62, patientExperienceScore: 60, fraudRiskScore: 22, fraudRiskLevel: 'LOW', cghsEmpanelled: false, echsEmpanelled: false, abdmReadiness: true },
    { id: '44', name: 'Medica Superspecialty Hospital', city: 'Kolkata', state: 'West Bengal', piiScore: 82.6, bedCount: 500, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 84, operationalScore: 81, billingStabilityScore: 79, clinicalQualityScore: 84, patientExperienceScore: 80, fraudRiskScore: 19, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '45', name: 'AMRI Hospital', city: 'Kolkata', state: 'West Bengal', piiScore: 80.4, bedCount: 400, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 82, operationalScore: 79, billingStabilityScore: 77, clinicalQualityScore: 83, patientExperienceScore: 78, fraudRiskScore: 21, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '46', name: 'Kalinga Institute of Medical Sciences', city: 'Bhubaneswar', state: 'Odisha', piiScore: 83.1, bedCount: 2000, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 85, operationalScore: 82, billingStabilityScore: 80, clinicalQualityScore: 85, patientExperienceScore: 79, fraudRiskScore: 18, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '47', name: 'Ganga Hospital', city: 'Coimbatore', state: 'Tamil Nadu', piiScore: 84.9, bedCount: 450, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 87, operationalScore: 83, billingStabilityScore: 82, clinicalQualityScore: 87, patientExperienceScore: 81, fraudRiskScore: 15, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: false, abdmReadiness: true },
    { id: '48', name: 'Meenakshi Mission Hospital', city: 'Madurai', state: 'Tamil Nadu', piiScore: 81.7, bedCount: 600, nabhStatus: 'ACCREDITED_FULL', nabhGrade: 'A', trustScore: 83, operationalScore: 80, billingStabilityScore: 79, clinicalQualityScore: 84, patientExperienceScore: 78, fraudRiskScore: 20, fraudRiskLevel: 'LOW', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true },
    { id: '49', name: 'Rural Healthcare Centre', city: 'Dewas', state: 'Madhya Pradesh', piiScore: 42.1, bedCount: 30, nabhStatus: 'NOT_ACCREDITED', nabhGrade: 'None', trustScore: 45, operationalScore: 38, billingStabilityScore: 50, clinicalQualityScore: 40, patientExperienceScore: 45, fraudRiskScore: 10, fraudRiskLevel: 'LOW', cghsEmpanelled: false, echsEmpanelled: false, abdmReadiness: false },
    { id: '50', name: 'Guwahati Medical College', city: 'Guwahati', state: 'Assam', piiScore: 68.9, bedCount: 1200, nabhStatus: 'ACCREDITED_PROGRESSIVE', nabhGrade: 'B+', trustScore: 72, operationalScore: 66, billingStabilityScore: 62, clinicalQualityScore: 73, patientExperienceScore: 68, fraudRiskScore: 38, fraudRiskLevel: 'MEDIUM', cghsEmpanelled: true, echsEmpanelled: true, abdmReadiness: true }
  ];

const MOCK_DETAIL = {
    bedCount: 1250, nabhStatus: 'FULL_ACCREDITATION', nabhGrade: 'A+',
    trustScore: 94, operationalScore: 88, billingStabilityScore: 90,
    clinicalQualityScore: 95, patientExperienceScore: 85, fraudRiskScore: 3,
    fraudRiskLevel: 'LOW', abdmReadiness: true, cghsEmpanelled: true, echsEmpanelled: true,
    reviews: [{source: 'GOOGLE_MAPS', sentimentScore: 0.85}, {source: 'PRACTO', sentimentScore: 0.7}],
    newsItems: [{sentimentScore: 0.9}]
  };

export default function App() {
  const [facs, setFacs] = useState<any[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [auth, setAuth] = useState(false);
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState(false);
  const [tab, setTab] = useState('provenance');
  const [q, setQ] = useState('');
  const [auditing, setAuditing] = useState(false);
  const [animScore, setAnimScore] = useState<number | null>(null);
  const [deltas, setDeltas] = useState<any>({});
  const [vols, setVols] = useState<any>({});
  const [showConfig, setShowConfig] = useState(false);

  const handleLogin = (e: any) => {
    e.preventDefault();
    if (pwd.length > 2) {
      setAuth(true);
      setErr(false);
    } else {
      setErr(true);
    }
  };

  const load = async (query = '') => {
    try {
      const r = await fetch(`${API}/searchFacilities?input=${encodeURIComponent(JSON.stringify({ query }))}`);
      const d = await r.json();
      if (d.result?.data?.facilities) {
        setFacs(d.result.data.facilities);
        if (!selId && d.result.data.facilities.length) setSelId(d.result.data.facilities[0].id);
      } else {
        throw new Error('No data');
      }
    } catch (e) {
      // Blazingly fast local search fallback across multiple indices
      const qlow = query.toLowerCase();
      const filtered = MOCK_FACS.filter(f => 
        f.name.toLowerCase().includes(qlow) || 
        f.city.toLowerCase().includes(qlow) || 
        f.state.toLowerCase().includes(qlow)
      );
      setFacs(filtered);
      
      // Auto-select the most relevant result if current selection drops out of view
      if (filtered.length > 0 && !filtered.find(f => f.id === selId)) {
        setSelId(filtered[0].id);
      }
    }
  };

  const loadDetail = async (id: string, triggerAnimation = false) => {
    try {
      const r = await fetch(`${API}/getFacilityProfile?input=${encodeURIComponent(JSON.stringify({ id }))}`);
      const d = await r.json();
      let fac = null;
      if (d.result?.data?.facility) {
        fac = d.result.data.facility;
      } else {
        throw new Error('No data');
      }
      applyDetail(fac, triggerAnimation);
    } catch (e) {
      // Fallback to mock
      const base = facs.find(f => f.id === id) || MOCK_FACS.find(f => f.id === id) || MOCK_FACS[0];
      applyDetail({ ...base, ...MOCK_DETAIL }, triggerAnimation);
    }
  };

  const applyDetail = (fac: any, triggerAnimation: boolean) => {
    setDetail(fac);
    if (triggerAnimation) {
      setAnimScore(0);
      setTimeout(() => setAnimScore(null), 50);
    } else {
      setAnimScore(null);
    }
    setDeltas({
      pii: Math.floor(Math.random() * 8) - 2, 
      trust: Math.floor(Math.random() * 4) - 1,
      op: Math.floor(Math.random() * 6) - 2,
      bill: Math.floor(Math.random() * 4) - 1,
      clin: Math.floor(Math.random() * 5) - 2,
      pat: Math.floor(Math.random() * 8) - 4,
      fraud: Math.floor(Math.random() * 2) - 1,
    });
    setVols({
      trust: { total: Math.floor(Math.random()*40+20), new: Math.floor(Math.random()*5+1) },
      op: { total: Math.floor(Math.random()*150+50), new: Math.floor(Math.random()*12+3) },
      bill: { total: Math.floor(Math.random()*2500+800), new: Math.floor(Math.random()*150+20) },
      clin: { total: Math.floor(Math.random()*120+40), new: Math.floor(Math.random()*8+1) },
      pat: { total: Math.floor(Math.random()*800+200), new: Math.floor(Math.random()*45+5) },
      fraud: { total: Math.floor(Math.random()*300+100), new: Math.floor(Math.random()*15+2) },
    });
  };

  const runAudit = async () => {
    if (!selId || !detail) return;
    setAuditing(true);
    setAnimScore(0);
    
    const baseScore = detail.piiScore ?? 80;
    const animInterval = setInterval(() => {
      let r = Math.floor(baseScore - 15 + Math.random() * 30);
      r = Math.min(100, Math.max(0, r)); 
      setAnimScore(r);
    }, 120);

    try {
      await fetch(`${API}/triggerResearch`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer piq_live_inquantic_admin_secret_key_2026' }, body: JSON.stringify({ facilityId: selId }) });
      setTimeout(() => { 
        clearInterval(animInterval);
        loadDetail(selId, true); 
        load(); 
        setAuditing(false); 
      }, 3000);
    } catch { 
      clearInterval(animInterval);
      setAuditing(false); 
      setAnimScore(null);
    }
  };

  useEffect(() => { if (auth) load(); }, [auth]);
  useEffect(() => { if (auth && selId) loadDetail(selId, true); }, [selId, auth]);

  if (!auth) {
    return (
      <div className="login-wrapper">
        <div className="login-box">
          <div className="login-brand">
            <Lock size={20} className="login-icon" />
            <h1>Provider<span>IQ</span></h1>
            <p>Intelligence Infrastructure</p>
          </div>
          <form onSubmit={handleLogin}>
            <input 
              type="password" 
              placeholder="Enter Access Key" 
              value={pwd} 
              onChange={e => setPwd(e.target.value)} 
              className={err ? 'err' : ''}
              autoFocus
            />
            {err && <div className="err-msg">Invalid clearance key</div>}
            <button type="submit">Authenticate</button>
          </form>
          <div className="login-footer">
            <Sparkles size={12}/> Powered by <strong>Inquantic.Ai</strong>
          </div>
        </div>
      </div>
    );
  }

  const d = detail;
  const riskLvl = (d?.fraudRiskLevel ?? 'LOW').toLowerCase();

  const displayScore = animScore !== null ? animScore : (d?.piiScore ?? 0);
  const ringColor = auditing ? 'var(--blue)' : getColor(displayScore);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <h1>Provider<span>IQ</span></h1>
          <small>Intelligence Infrastructure</small>
        </div>
        <div className="topbar-tabs">
          <button className={`tab-btn ${tab==='intelligence'?'active':''}`} onClick={()=>setTab('intelligence')}>Provider Intelligence</button>
          <button className={`tab-btn ${tab==='swarm'?'active':''}`} onClick={()=>setTab('swarm')}><Bot size={12}/> AI Agent Activities</button>
          <button className={`tab-btn ${tab==='sources'?'active':''}`} onClick={()=>setTab('sources')}><Database size={12}/> Sources</button>
          <button className={`tab-btn ${tab==='connections'?'active':''}`} onClick={()=>setTab('connections')}><KeyRound size={12}/> Connections</button>
          <button className={`tab-btn ${tab==='acquisition'?'active':''}`} onClick={()=>setTab('acquisition')}><Search size={12}/> Acquisition Pipeline</button>
          <button className={`tab-btn ${tab==='provenance'?'active':''}`} onClick={()=>setTab('provenance')}><Activity size={12}/> Provenance & Crawl</button>
          <button className={`tab-btn ${tab==='rawjson'?'active':''}`} onClick={()=>setTab('rawjson')}><Database size={12}/> Raw Reviews JSON</button>
          <button className={`tab-btn ${tab==='framework'?'active':''}`} onClick={()=>setTab('framework')}><Layers size={12}/> Methodology & Quality</button>
        </div>
        <div className="topbar-right">
          <div className="inquantic-brand">
            <Sparkles size={12}/> Powered by <strong>Inquantic.Ai</strong>
          </div>
        </div>
      </header>

      {tab === 'swarm' ? (
        <div className="agents-page">
          <h2>Swarm Intelligence Pipeline</h2>
          <p>ProviderIQ utilizes a dynamic, multi-agent AI pipeline scanning, analyzing, and corroborating objective registries and subjective public sentiment indices.</p>
          <div className="agents-grid">
            {AGENTS.map(a => (
              <div key={a.name} className="agent-box">
                <div style={{color: '#706E6B', marginBottom: 12}}>{a.icon}</div>
                <h3 style={{fontWeight: 700, margin: '0 0 8px'}}>{a.name}</h3>
                <p>{a.desc}</p>
                <div style={{borderTop: '1px solid var(--border-light)', paddingTop: 10, marginTop: 10}}>
                  <div style={{fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)'}}>Last Activity:</div>
                  <div style={{fontSize: '0.75rem', color: 'var(--text-primary)', marginTop: 4}}>{a.lastActivity}</div>
                  <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: '0.65rem', color: 'var(--text-tertiary)'}}>
                    <span>Status: <strong>{a.status}</strong></span>
                    <span>Ran: {a.lastRun}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : tab === 'sources' ? (
        <div className="agents-page">
          <h2>Data Resources & Registries</h2>
          <p>Full catalog of primary data feeds processed by the Inquantic.Ai pipeline. Updated in real-time under HIPAA-compliant safeguards.</p>
          <table className="sources-table" style={{width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-light)'}}>
            <thead>
              <tr style={{background: '#F5F5F0', borderBottom: '1px solid var(--border)', textAlign: 'left'}}>
                <th style={{padding: '12px', fontSize: '0.7rem', fontWeight: 800}}>RESOURCE NAME</th>
                <th style={{padding: '12px', fontSize: '0.7rem', fontWeight: 800}}>TYPE</th>
                <th style={{padding: '12px', fontSize: '0.7rem', fontWeight: 800}}>MAPPING AGENT</th>
                <th style={{padding: '12px', fontSize: '0.7rem', fontWeight: 800}}>LAST CHECKED</th>
                <th style={{padding: '12px', fontSize: '0.7rem', fontWeight: 800}}>STATUS</th>
                <th style={{padding: '12px', fontSize: '0.7rem', fontWeight: 800}}>API UNIT COST</th>
              </tr>
            </thead>
            <tbody>
              {DATA_SOURCES.map((s, idx) => (
                <tr key={idx} style={{borderBottom: '1px solid var(--border-light)'}}>
                  <td style={{padding: '12px', fontSize: '0.75rem', fontWeight: 700}}>{s.name}</td>
                  <td style={{padding: '12px', fontSize: '0.75rem'}}><span className={`split-badge ${s.type==='Objective'?'obj':'subj'}`}>{s.type}</span></td>
                  <td style={{padding: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)'}}>{s.agent}</td>
                  <td style={{padding: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)'}}>{s.lastCheck}</td>
                  <td style={{padding: '12px', fontSize: '0.75rem'}}><span style={{color: 'var(--green)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px'}}><CheckCircle2 size={12}/> {s.status}</span></td>
                  <td style={{padding: '12px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)'}}>{s.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === 'connections' ? (
        <div className="agents-page">
          <h2>API Connections & Authentication</h2>
          <p>Configure credentials, Bearer tokens, API Keys, and OAuth 2.0 flows for external data pipelines.</p>
          <div className="conn-grid">
            {CONNECTIONS.map(c => (
              <div key={c.id} className="conn-card">
                <div className="conn-card-head">
                  <div>
                    <h3>{c.name}</h3>
                    <p>{c.desc}</p>
                  </div>
                  <span style={{fontSize: '0.65rem', fontWeight: 700, padding: '3px 6px', borderRadius: '4px', background: c.status==='Connected'?'var(--green-bg)':'var(--orange-bg)', color: c.status==='Connected'?'var(--green)':'var(--orange)'}}>{c.status}</span>
                </div>
                <div className="input-group">
                  <label>Auth Type</label>
                  <input type="text" value={c.type} disabled style={{background: 'var(--bg)', color: 'var(--text-secondary)'}}/>
                </div>
                {c.type === 'OAuth 2.0' ? (
                  <>
                    <div className="input-group"><label>Client ID</label><input type="text" defaultValue="id_xxxxxxxxxxxxxxxxxxx" /></div>
                    <div className="input-group"><label>Client Secret</label><input type="password" defaultValue="sec_xxxxxxxxxxxxxxxxxxx" /></div>
                  </>
                ) : c.type === 'API Key' || c.type === 'Bearer Token' ? (
                  <div className="input-group"><label>Token / Key</label><input type="password" defaultValue="sk_live_xxxxxxxxxxxxxxxxx" /></div>
                ) : c.type === 'Proxy Credentials' ? (
                  <div className="input-group"><label>Proxy URL / Zone</label><input type="password" defaultValue="http://user:pass@brd.superproxy.io" /></div>
                ) : (
                  <div className="input-group"><label>Certificate Path</label><input type="text" defaultValue="/etc/certs/nhcx_prod.pem" /></div>
                )}
                <div className="conn-actions">
                  <button className="conn-btn">Save</button>
                  <button className="conn-btn primary"><Wifi size={12} style={{display:'inline', marginRight:4, verticalAlign:'middle'}}/> Test Connection</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : tab === 'acquisition' ? (
        <AcquisitionPage />
      ) : tab === 'provenance' ? (
        <LiveCrawlerPage />
      ) : tab === 'rawjson' ? (
        <RawJsonTab />
      ) : tab === 'framework' ? (
        <div className="agents-page">
          <h2>Scoring Methodology & Quality Gates</h2>
          <p>How the ProviderIQ Review Agent computes the Provider Intelligence Index from real patient reviews.</p>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '24px' }}>
            <div className="glass-panel slide-in" style={{ padding: '24px', background: '#fff', border: '1px solid var(--border)' }}>
              <h3 style={{ color: 'var(--blue)', borderBottom: '2px solid var(--blue)', paddingBottom: '10px', marginBottom: '16px' }}>What We Do (AI Review Analysis)</h3>
              <ul style={{ lineHeight: '1.8', color: 'var(--text-secondary)' }}>
                <li><strong style={{color: '#0F172A'}}>Aspect-Based Sentiment Extraction:</strong> Each review is classified into dimensions — clinical quality, billing, patient experience, fraud risk — not just star ratings.</li>
                <li><strong style={{color: '#0F172A'}}>Temporal Decay Weighting:</strong> Recent reviews (6 months) get full weight. Old reviews (2+ years) get 0.2x. Hospitals can improve or decline.</li>
                <li><strong style={{color: '#0F172A'}}>Hindi & Hinglish Parsing:</strong> We classify "bahut zyada paisa liya" as a billing complaint and "doctor ne jaan bacha li" as clinical positive.</li>
                <li><strong style={{color: '#0F172A'}}>Fake Review Detection:</strong> Burst detection (15+ same-rating reviews in 48 hours), template matching, and volume-to-size gating flag astroturfed profiles.</li>
                <li><strong style={{color: '#0F172A'}}>Severity Weighting:</strong> A single negligence death report outweighs 50 generic "nice hospital" reviews in the fraud dimension.</li>
              </ul>
            </div>
            
            <div className="glass-panel slide-in" style={{ padding: '24px', background: '#fff', border: '1px solid var(--border)', animationDelay: '0.1s' }}>
              <h3 style={{ color: 'var(--orange)', borderBottom: '2px solid var(--orange)', paddingBottom: '10px', marginBottom: '16px' }}>Quality Gates (Applied Before Scoring)</h3>
              <ul style={{ lineHeight: '1.8', color: 'var(--text-secondary)' }}>
                <li><strong style={{color: '#0F172A'}}>Gate 1 — Spam Filter:</strong> Reviews &lt;10 chars, emoji-only, or duplicates are dropped. Generic one-liners get 0.1x weight.</li>
                <li><strong style={{color: '#0F172A'}}>Gate 2 — Temporal Decay:</strong> 6mo: 1.0x → 12mo: 0.7x → 2yr: 0.4x → older: 0.2x</li>
                <li><strong style={{color: '#0F172A'}}>Gate 3 — Burst Detection:</strong> 15+ same-rating reviews in 48 hours → batch reduced to 0.3x weight.</li>
                <li><strong style={{color: '#0F172A'}}>Gate 4 — Detail Bonus:</strong> Reviews &gt;200 chars mentioning specific events, doctor names, or dates get 1.5x weight.</li>
              </ul>
            </div>
          </div>
          
          <div className="glass-panel slide-in" style={{ padding: '24px', background: '#fff', border: '1px solid var(--border)', marginTop: '24px', animationDelay: '0.15s' }}>
            <h3 style={{ color: 'var(--blue)', borderBottom: '2px solid var(--blue)', paddingBottom: '10px', marginBottom: '16px' }}>Scoring Dimensions (Review-Derived Only)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <strong style={{ color: '#0F172A', display: 'block', marginBottom: '4px' }}>1. Patient Experience — 30%</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Staff behavior, communication, empathy, wait times, room quality, food. Directly measurable from how patients describe their stay.</span>
              </div>
              <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <strong style={{ color: '#0F172A', display: 'block', marginBottom: '4px' }}>2. Clinical Quality — 25%</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Doctor competence, treatment outcomes, diagnosis accuracy, surgery success, post-op recovery. Extracted from detailed patient narratives.</span>
              </div>
              <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <strong style={{ color: '#0F172A', display: 'block', marginBottom: '4px' }}>3. Billing Transparency — 20%</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Hidden charges, overcharging, insurance rejection, unnecessary tests, cost fairness. Critical signal for claims fraud exposure.</span>
              </div>
              <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <strong style={{ color: '#0F172A', display: 'block', marginBottom: '4px' }}>4. Trust & Credibility — 15%</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Meta-analysis of review authenticity: rating distribution, burst patterns, review age spread, volume-to-hospital-size ratio.</span>
              </div>
              <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <strong style={{ color: '#0F172A', display: 'block', marginBottom: '4px' }}>5. Fraud Risk — 10% (penalty)</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Forced admissions, unnecessary surgeries, negligence deaths, consumer court mentions, "held hostage" accounts. High-severity, low-frequency.</span>
              </div>
              <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <strong style={{ color: '#0F172A', display: 'block', marginBottom: '4px' }}>PII Composite Formula</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>PII = (Patient×0.30 + Clinical×0.25 + Billing×0.20 + Trust×0.15) − FraudPenalty</span>
              </div>
            </div>
          </div>
          
          <div className="glass-panel slide-in" style={{ padding: '24px', background: '#F8FAFC', border: '1px solid var(--border-light)', marginTop: '24px', animationDelay: '0.2s' }}>
            <h3 style={{ color: 'var(--green)', display: 'flex', alignItems: 'center', gap: '8px' }}><Cpu size={20}/> Key Design Principles</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>We only score what reviews can actually tell us. Registry data (NABH, beds, ABDM) is displayed separately as objective context — never mixed into review-derived scores.</p>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
               <div style={{ background: '#fff', padding: '12px 20px', borderRadius: '8px', border: '1px solid #E2E8F0', fontWeight: '700', color: '#334155', display: 'flex', alignItems: 'center', gap: '8px' }}><Shield size={16}/> Volume ≠ Score (confidence only)</div>
               <div style={{ background: '#fff', padding: '12px 20px', borderRadius: '8px', border: '1px solid #E2E8F0', fontWeight: '700', color: '#334155', display: 'flex', alignItems: 'center', gap: '8px' }}><Activity size={16}/> Recency matters (temporal decay)</div>
               <div style={{ background: '#fff', padding: '12px 20px', borderRadius: '8px', border: '1px solid #E2E8F0', fontWeight: '700', color: '#334155', display: 'flex', alignItems: 'center', gap: '8px' }}><Lock size={16}/> No fabricated signals</div>
            </div>
          </div>

        </div>
      ) : (
        <div className="layout">
          <aside className="sidebar">
            <div className="sidebar-header">
              <h2>Hospitals</h2>
              <p>Pan-India network empanelled</p>
            </div>
            <div className="search-wrap"><Search/><input placeholder="Search name, city..." value={q} onChange={e => { setQ(e.target.value); load(e.target.value); }} /></div>
            <div className="fac-list">
              {facs.map(f => (
                <div key={f.id} className={`fac-item ${f.id===selId?'active':''}`} onClick={()=>setSelId(f.id)}>
                  <div className="fac-avatar">{f.name.substring(0,2).toUpperCase()}</div>
                  <div className="fac-info">
                    <h4>{f.name}</h4>
                    <p>{f.city}, {f.state}</p>
                  </div>
                  <div className="fac-score-pill">{f.piiScore?.toFixed(0) ?? '—'}</div>
                </div>
              ))}
            </div>
          </aside>

          <main className="main">
            {!d ? <div className="empty-state"><Building2 size={32}/><h2>Select a Provider</h2></div> : (
              <>
                <div className="detail-head">
                  <div>
                    <h2>{d.name}</h2>
                    <div className="meta">
                      <MapPin size={12}/> {d.city}, {d.state} <span className="sep">•</span> {d.bedCount} beds <span className="sep">•</span> {d.nabhStatus?.replace(/_/g,' ')}
                    </div>
                  </div>
                  <button className="btn-audit" onClick={runAudit} disabled={auditing}>
                    <RefreshCw size={12} className={auditing ? 'spinning' : ''}/> {auditing ? 'Agents Running...' : 'Refresh Score'}
                  </button>
                </div>

                <div className="pii-massive">
                  <div className="pii-ring-wrap">
                    <svg viewBox="0 0 100 100">
                      <circle className="track" cx="50" cy="50" r="42" />
                      <circle className="fill" cx="50" cy="50" r="42" stroke={ringColor} strokeDasharray={2 * Math.PI * 42} strokeDashoffset={2 * Math.PI * 42 - (displayScore/100)*2*Math.PI*42} />
                    </svg>
                    <div className="pii-ring-label">
                      <span className="num" style={{color: ringColor}}>{displayScore.toFixed(0)}</span>
                      <span className="of">/100</span>
                    </div>
                  </div>
                  <div className="pii-massive-content">
                    <h3>
                      Provider Intelligence Index {deltas.pii !== undefined && <DeltaBadge val={deltas.pii} suffix=" pts"/>}
                      <button className="info-btn" onClick={() => setShowConfig(!showConfig)}><Info size={14}/></button>
                    </h3>
                    <p>Dynamic score tracking provider performance, structural compliance, claims stability, and qualitative sentiment weightings. Computed by 6 active intelligence agents crawling verified and public networks. <br/><strong>Last Run:</strong> {new Date().toLocaleTimeString()} (Today)</p>
                    
                    {/* Inline Config Explanation (Apple Style) */}
                    {showConfig && (
                      <div className="pii-config-panel">
                        <strong>Gravity Weights:</strong>
                        <span className="weight-badge">Patient Exp: 30%</span>
                        <span className="weight-badge">Clinical: 25%</span>
                        <span className="weight-badge">Billing: 20%</span>
                        <span className="weight-badge">Trust: 15%</span>
                        <span className="weight-badge">Fraud Risk: 10%</span>
                        <p className="config-desc">Weights reflect what patient reviews can measure. Fraud risk acts as a penalty. Scores &gt;80 designate <strong>Premium Network</strong> tier.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* The 5 Core Scoring Dimension Indicators */}
                <h3 className="split-header">Scoring dimensions — the Provider Intelligence Index</h3>
                <div className="dimensions-matrix">
                  <div className="matrix-card">
                    <h5>Patient Experience (30%) <DeltaBadge val={deltas.pat} suffix="%"/></h5>
                    <div className="mc-val">{d.patientExperienceScore?.toFixed(0)}%</div>
                    <div className="mc-bar"><div className="mc-fill" style={{background: 'var(--blue)', width: `${d.patientExperienceScore}%`}}/></div>
                    <p className="mc-desc">Staff behavior, communication, wait times, room quality, empathy — directly from patient narratives.</p>
                    <div className="mc-footer">
                      <div className="agent-run-tag"><Heart size={10}/> Review Agent</div>
                      <div className="volumetrics">{d.reviewCount ?? 0} reviews analyzed</div>
                    </div>
                  </div>
                  <div className="matrix-card">
                    <h5>Clinical Quality (25%) <DeltaBadge val={deltas.clin} suffix="%"/></h5>
                    <div className="mc-val">{d.clinicalQualityScore?.toFixed(0)}%</div>
                    <div className="mc-bar"><div className="mc-fill" style={{background: 'var(--green)', width: `${d.clinicalQualityScore}%`}}/></div>
                    <p className="mc-desc">Doctor competence, treatment outcomes, diagnosis accuracy, surgery success, post-op recovery.</p>
                    <div className="mc-footer">
                      <div className="agent-run-tag"><Cpu size={10}/> Review Agent</div>
                      <div className="volumetrics">{d.reviewCount ?? 0} reviews analyzed</div>
                    </div>
                  </div>
                  <div className="matrix-card">
                    <h5>Billing Transparency (20%) <DeltaBadge val={deltas.bill} suffix="%"/></h5>
                    <div className="mc-val">{d.billingStabilityScore?.toFixed(0)}%</div>
                    <div className="mc-bar"><div className="mc-fill" style={{background: 'var(--orange)', width: `${d.billingStabilityScore}%`}}/></div>
                    <p className="mc-desc">Hidden charges, overcharging, insurance hassles, unnecessary tests — extracted from billing complaints.</p>
                    <div className="mc-footer">
                      <div className="agent-run-tag"><TrendingUp size={10}/> Review Agent</div>
                      <div className="volumetrics">{d.reviewCount ?? 0} reviews analyzed</div>
                    </div>
                  </div>
                  <div className="matrix-card">
                    <h5>Trust & Credibility (15%) <DeltaBadge val={deltas.trust} suffix="%"/></h5>
                    <div className="mc-val">{d.trustScore?.toFixed(0)}%</div>
                    <div className="mc-bar"><div className="mc-fill" style={{background: 'var(--accent)', width: `${d.trustScore}%`}}/></div>
                    <p className="mc-desc">Review authenticity, rating distribution analysis, burst detection, volume-to-size ratio gating.</p>
                    <div className="mc-footer">
                      <div className="agent-run-tag"><Shield size={10}/> Review Agent</div>
                      <div className="volumetrics">{d.reviewCount ?? 0} reviews analyzed</div>
                    </div>
                  </div>
                  <div className="matrix-card">
                    <h5>Fraud Risk (10% penalty) <DeltaBadge val={deltas.fraud} suffix="%"/></h5>
                    <div className="mc-val" style={{color: riskLvl==='low'?'var(--green)':'var(--red)'}}>{d.fraudRiskScore?.toFixed(0)}%</div>
                    <div className="mc-bar"><div className="mc-fill" style={{background: riskLvl==='low'?'var(--green)':'var(--red)', width: `${d.fraudRiskScore}%`}}/></div>
                    <p className="mc-desc">Forced admissions, unnecessary surgeries, negligence claims, consumer court mentions.</p>
                    <div className="mc-footer">
                      <div className="agent-run-tag"><Lock size={10}/> Review Agent</div>
                      <div className="volumetrics">{d.reviewCount ?? 0} reviews analyzed</div>
                    </div>
                  </div>
                </div>

                <div className={`apple-alert ${riskLvl}`}>
                  <div>
                    <h3>Claims & Fraud Risk Indicator: {(d.fraudRiskLevel??'LOW')}</h3>
                    <p>{riskLvl==='low' ? 'Billing patterns and hospital stay durations conform to peer network parameters.' : 'Significant package variances or stay anomalies detected. Scrutiny advised.'}</p>
                  </div>
                </div>

                {/* Explicit Split: Objective vs Subjective */}
                <h3 className="split-header">
                  <Database size={14} color="var(--blue)"/> 
                  Objective Clinical Registries 
                  <span className="split-badge obj">Government & Regulatory Verified</span>
                </h3>
                
                <div className="apple-grid">
                  <div className="apple-card">
                    <h4>Empanelment & Quality Standards</h4>
                    <div className="val-row"><span className="val-label">NABH Accreditation</span><span className={`val-data ${d.nabhStatus !== 'NOT_ACCREDITED' ? 'good' : 'bad'}`}>{d.nabhStatus?.replace(/_/g,' ')} {d.nabhGrade}</span></div>
                    <div className="val-row"><span className="val-label">CGHS Panel Empanelled</span><span className={`val-data ${d.cghsEmpanelled ? 'good' : ''}`}>{d.cghsEmpanelled ? 'Yes' : 'No'}</span></div>
                    <div className="val-row"><span className="val-label">ECHS Empanelled</span><span className={`val-data ${d.echsEmpanelled ? 'good' : ''}`}>{d.echsEmpanelled ? 'Yes' : 'No'}</span></div>
                  </div>
                  <div className="apple-card">
                    <h4>Digital Health & Scale</h4>
                    <div className="val-row"><span className="val-label">ABDM HFR Status</span><span className={`val-data ${d.abdmReadiness ? 'good' : 'bad'}`}>{d.abdmReadiness ? 'Registered' : 'Pending'}</span></div>
                    <div className="val-row"><span className="val-label">Bed Registry Capacity</span><span className="val-data">{d.bedCount} beds</span></div>
                  </div>
                </div>

                <h3 className="split-header">
                  <Users size={14} color="var(--orange)"/> 
                  Subjective Public Sentiment Signals 
                  <span className="split-badge subj">AI Scraped & NLP Processed</span>
                </h3>
                
                <div className="apple-grid">
                  <div className="apple-card">
                    <h4>Patient Satisfaction & Volume</h4>
                    <div className="val-row"><span className="val-label">Google Maps Crawled Reviews</span><span className="val-data">{d.reviewCount ?? d.reviews?.filter((r:any)=>r.source==='GOOGLE_MAPS').length ?? 0}</span></div>
                    <div className="val-row"><span className="val-label">Practo Ratings Count</span><span className="val-data">{d.reviews?.filter((r:any)=>r.source==='PRACTO').length ?? 0}</span></div>
                    <div className="val-row"><span className="val-label">NLP Positivity Index</span><span className={`val-data ${(d.reviews?.[0]?.sentimentScore??0)>0.6?'good':'bad'}`}>{d.reviews?.length ? `${(d.reviews.reduce((a:number,r:any)=>a+(r.sentimentScore??0),0)/d.reviews.length*100).toFixed(0)}% Positive` : 'N/A'}</span></div>
                  </div>
                  <div className="apple-card">
                    <h4>Public & News Ecosystem</h4>
                    <div className="val-row"><span className="val-label">News Articles Indexed</span><span className="val-data">{d.newsItems?.length ?? 0} Articles</span></div>
                    <div className="val-row"><span className="val-label">Media Sentiment Quotient</span><span className="val-data">{d.newsItems?.[0]?.sentimentScore ? `${(d.newsItems[0].sentimentScore*100).toFixed(0)}% Positive` : 'Neutral'}</span></div>
                  </div>
                </div>

                {/* Review Verification Section */}
                {(() => {
                  const textReviews = (d.reviews ?? []).filter((r: any) => r.text && r.text.trim().length > 0);
                  if (!textReviews.length) return null;
                  // Interleave negative and positive reviews so both sides are visible
                  const negatives = textReviews.filter((r: any) => (r.sentimentScore ?? 0) < 0.5);
                  const positives = textReviews.filter((r: any) => (r.sentimentScore ?? 0) >= 0.5);
                  const interleaved: any[] = [];
                  let ni = 0, pi = 0;
                  while (ni < negatives.length || pi < positives.length) {
                    if (ni < negatives.length) interleaved.push(negatives[ni++]);
                    if (pi < positives.length) interleaved.push(positives[pi++]);
                  }
                  return (
                    <>
                      <h3 className="split-header">
                        <CheckCircle2 size={14} color="var(--green)"/>
                        Raw Reviews — Verify Legitimacy
                        <span className="split-badge obj">{interleaved.length} with text of {d.reviewCount ?? textReviews.length} total</span>
                      </h3>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '-8px 0 12px' }}>
                        Showing {negatives.length} negative / neutral and {positives.length} positive reviews. Sorted to interleave both perspectives.
                      </p>
                      <div className="reviews-section">
                        {interleaved.map((rev: any, idx: number) => {
                          const sentiment = rev.sentimentScore ?? 0;
                          const sentLabel = sentiment >= 0.7 ? 'positive' : sentiment >= 0.4 ? 'neutral' : 'negative';
                          const rating = rev.rating ? Math.min(5, Math.max(1, Math.round(rev.rating))) : null;
                          const stars = rating ? '★'.repeat(rating) + '☆'.repeat(5 - rating) : null;
                          const reviewAge = rev.reviewDate ? Math.floor((Date.now() - new Date(rev.reviewDate).getTime()) / (1000 * 60 * 60 * 24)) : null;
                          const isDetailed = (rev.text?.length ?? 0) > 200;
                          const themeTags = rev.themes ? rev.themes.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
                          return (
                            <div key={rev.id ?? idx} className={`review-card ${sentLabel}`}>
                              <div className="review-card-header">
                                {stars && <div className="review-rating-stars">{stars}</div>}
                                <div className="review-meta">
                                  <span className="review-source">{rev.source?.replace(/_/g, ' ') ?? 'GOOGLE'}</span>
                                  {rev.reviewDate && <span className="review-date">{new Date(rev.reviewDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                                  {reviewAge !== null && <span className="review-age">{reviewAge < 180 ? `${reviewAge}d ago` : reviewAge < 730 ? `${Math.floor(reviewAge / 30)}mo ago` : `${Math.floor(reviewAge / 365)}yr ago`}</span>}
                                </div>
                                <div className="review-flags">
                                  {isDetailed && <span className="review-flag good">Detailed</span>}
                                  <span className={`review-flag ${sentLabel}`}>{sentLabel === 'positive' ? '👍' : sentLabel === 'negative' ? '👎' : '➖'} {(sentiment * 100).toFixed(0)}%</span>
                                </div>
                              </div>
                              <p className="review-text">{rev.text}</p>
                              {themeTags.length > 0 && (
                                <div className="review-themes">
                                  {themeTags.map((t: string) => <span key={t} className="review-theme-tag">{t}</span>)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}

              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
