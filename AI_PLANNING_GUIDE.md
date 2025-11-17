# AI-Driven Planning Mode - Complete Guide

## ✅ What Changed

### Before (Static Questions)
- 4 pre-defined questions (Objective, Context, Constraints, Verification)
- Linear workflow with no flexibility
- No real AI involvement - just form filling
- Limited context gathering

### After (AI-Driven Conversation)
- **Dynamic AI conversation** using your chosen Ollama model
- **Intelligent follow-up questions** based on your responses
- **Contextual understanding** - AI asks what it needs to know
- **Research capability** - AI can probe for technical details
- **Flexible workflow** - conversation adapts to your needs
- **User-controlled** - YOU decide when planning is complete

## 🎯 How It Works

### 1. Start Planning
1. Select "Planning Mode" from home page
2. Click "Start Planning" button
3. AI greets you and asks what you want to accomplish

### 2. Conversational Planning
- **You:** Explain your task/objective
- **AI:** Asks intelligent follow-up questions about:
  - Technical details and environment
  - Constraints and requirements
  - Current implementation status
  - Testing and verification approach
  - Edge cases and potential issues

### 3. Interactive Back-and-Forth
- AI adapts questions based on your responses
- You can upload images for visual context
- AI probes deeper on important areas
- Conversation continues until YOU'RE satisfied

### 4. Finalize Planning
- When you have provided enough context, click **"Done Planning"**
- AI generates comprehensive XML-formatted prompt
- Preview appears in right panel
- Options to copy or transfer to Instant Mode

## 📝 Example Conversation Flow

```
AI: Hi! I'm here to help you create a comprehensive plan.
    What would you like to accomplish?

YOU: I want to add a dark mode toggle to my React app

AI: Great! Can you tell me about your current React setup?
    Are you using any specific state management library,
    and how is your styling currently implemented?

YOU: Using React 18 with Context API, styled-components for CSS

AI: Perfect. Do you need the dark mode preference to persist
    across sessions? And should it respect the user's system
    preference as a default?

YOU: Yes to both - persist in localStorage and respect system pref

AI: Understood. How do you plan to test this? Should we consider
    edge cases like users switching themes mid-session or having
    multiple tabs open?

YOU: Good point - need to handle tab synchronization

AI: Excellent. It sounds like we have a solid foundation.
    Are you ready to finalize the plan, or is there anything
    else I should know?

YOU: [clicks "Done Planning"]

AI: ✅ Planning complete! I've generated a comprehensive
    prompt based on our conversation...
```

## 🚀 Key Features

### 1. Uses YOUR Chosen Model
- Planning AI = whatever model you selected in Settings
- Leverages your model's knowledge and capabilities
- Different models = different planning styles

### 2. Context-Aware Questions
- AI remembers the conversation
- Questions build on previous answers
- No redundant questions

### 3. Research Mode
- AI can ask about:
  - Technical stack and environment
  - Existing implementations
  - Dependencies and constraints
  - Performance requirements
  - Testing strategies

### 4. Flexible Completion
- **YOU** control when it's done
- No forced question limits
- Can be quick (3-4 exchanges) or thorough (10+ exchanges)
- Click "Done Planning" whenever satisfied

### 5. Image Support
- Upload screenshots, diagrams, mockups
- AI can reference visual context
- Helpful for UI/UX tasks

## 🎨 UI Elements

### Planning Conversation Area
- **AI messages** - Green avatar, question bubbles
- **Your messages** - Blue avatar, response bubbles
- **Loading indicator** - Animated dots while AI thinks

### Input Composer
- **Text area** - Type your responses
- **Image button** - Upload visual context
- **Done Planning** - Green button (when satisfied)
- **Send** - Submit response to AI
- **Ctrl/Cmd+Enter** - Keyboard shortcut to send

### Right Panel
- **Prompt Preview** - Shows generated prompt after "Done"
- **Action Buttons:**
  - Copy Prompt - Copy to clipboard
  - Transfer to Instant - Send to chat mode

## 💡 Tips for Best Results

### 1. Be Specific in Initial Request
✅ "Add authentication to my Express API using JWT tokens"
❌ "Make my app more secure"

### 2. Provide Context Proactively
- Mention your tech stack upfront
- Share relevant constraints
- Note what you've already tried

### 3. Let AI Ask Questions
- Don't dump everything at once
- Answer what's asked
- Let the conversation flow naturally

### 4. Use Images When Helpful
- UI mockups
- Architecture diagrams
- Error screenshots
- Current state screenshots

### 5. Know When to Stop
- When AI starts asking less relevant questions
- When you feel you've covered the important points
- When you're ready to execute

## 🔧 Technical Details

### How AI Generates Questions
The planning AI uses this system prompt:

```
You are a planning assistant helping gather requirements.

Your role:
1. Ask intelligent, contextual questions
2. Probe for technical details, constraints, environment
3. Help user think through edge cases
4. Be conversational but focused
5. When user has provided sufficient detail, acknowledge it

Ask ONE focused follow-up question at a time.
```

### How Final Prompt is Generated
When you click "Done Planning":

1. AI reviews entire conversation
2. Extracts key information
3. Structures it into XML format:
   ```xml
   <task>
     <objective>Clear goal</objective>
     <context>Technical details</context>
     <constraints>Requirements</constraints>
     <verification>Testing approach</verification>
     <execution>Specific steps</execution>
   </task>
   ```

### Auto-Save
- Conversation auto-saves every 30 seconds
- Persists to session storage
- Resume planning if interrupted

## 🆚 When to Use Each Mode

### Use Planning Mode When:
- Complex, multi-step tasks
- Need to think through requirements
- Want AI help exploring edge cases
- Building something new
- Need comprehensive documentation

### Use Instant Mode When:
- Quick questions
- Simple fixes
- Code reviews
- Straightforward tasks
- You know exactly what you want

## 📊 Comparison

| Feature | Planning Mode | Instant Mode |
|---------|---------------|--------------|
| **Speed** | Slower (deliberate) | Fast (immediate) |
| **Thoroughness** | Very thorough | As detailed as your prompt |
| **AI Involvement** | High (guides you) | Low (executes your request) |
| **Best For** | Complex tasks | Simple tasks |
| **Output** | Structured prompt | Direct code/answer |

## 🎯 Success Metrics

Good planning conversation should result in:
- ✅ Clear objective stated
- ✅ Technical context provided
- ✅ Constraints identified
- ✅ Verification approach defined
- ✅ Edge cases considered
- ✅ Executable plan generated

## 🐛 Troubleshooting

### AI Not Responding
- Check Ollama is running: `ollama list`
- Verify model is downloaded
- Check network connection (if cloud mode)

### AI Asks Irrelevant Questions
- Provide more specific initial request
- Answer with "Let's focus on [X] instead"
- Click "Done Planning" if satisfied

### Conversation Too Long
- Be more concise in responses
- Skip optional questions
- Click "Done Planning" when ready

### Generated Prompt Not Good
- Have a more thorough conversation
- Provide more technical details
- Try again with different approach

## 🚀 Getting Started

1. **Open Planning Mode**
   - From home page, click "Planning" card

2. **Click "Start Planning"**
   - AI greets you

3. **Describe Your Task**
   - Be clear but don't overthink it

4. **Answer AI's Questions**
   - Respond naturally
   - Add images if helpful

5. **Click "Done Planning" When Ready**
   - AI generates comprehensive prompt

6. **Copy or Transfer to Instant**
   - Use the generated prompt

---

## 🎉 Enjoy More Intelligent Planning!

The new AI-driven system makes planning **conversational**, **adaptive**, and **powerful**.
Your chosen Ollama model is now your planning partner, not just a form to fill out.

Happy planning! 🚀
